import * as cdk from 'aws-cdk-lib';
import { AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { DockerImageAsset } from 'aws-cdk-lib/aws-ecr-assets';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import { Construct } from 'constructs';
import { join } from 'path';
import { getConfig } from '../lib/config';

const config = getConfig();

// stack to create essential resources such as db, storage, and triggers
export class CdkEsyncInfraStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Create a DynamoDB table for the application data
    const app_table = new cdk.aws_dynamodb.Table(this, 'app_table', {
      tableName: config.TABLE_NAME,
      removalPolicy: cdk.RemovalPolicy.RETAIN,
      billingMode: BillingMode.PAY_PER_REQUEST,
      partitionKey: { name: 'PK', type: AttributeType.STRING },
      sortKey: { name: 'SK', type: AttributeType.STRING },
      encryption: cdk.aws_dynamodb.TableEncryption.AWS_MANAGED,
    });

    // Create an S3 bucket for YouTube uploads
    const s3_yt_upload_bucket = new cdk.aws_s3.Bucket(
      this,
      's3_yt_upload_bucket',
      {
        bucketName: config.BUCKET_NAME,
        removalPolicy: cdk.RemovalPolicy.RETAIN,
        // autoDeleteObjects: true,
        lifecycleRules: [
          {
            // Expire incomplete uploads after 90 days
            // abortIncompleteMultipartUploadAfter: cdk.Duration.days(90),
            // Expire objects after 21 days
            expiration: cdk.Duration.days(21),
            // Transition objects to Infrequent Access storage class after 30 days
            // transitions: [
            //   {
            //     storageClass: cdk.aws_s3.StorageClass.INFREQUENT_ACCESS,
            //     transitionAfter: cdk.Duration.days(30),
            //   },
            //   // Add more transitions as needed
            // ],
          },
        ],
        cors: [
          {
            // Define CORS rules for the S3 bucket
            allowedMethods: [
              cdk.aws_s3.HttpMethods.GET,
              cdk.aws_s3.HttpMethods.POST,
              cdk.aws_s3.HttpMethods.PUT,
            ],
            allowedOrigins: ['*'],
            allowedHeaders: ['*'],
          },
        ],
      }
    );

    // Create a Lambda function to handle S3 uploads
    const s3_yt_upload_trigger = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      's3_yt_upload_trigger',
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_16_X,
        handler: 'handler',
        entry: process.env.S3_UPLOAD_TRIGGER_LAMBDA_PATH,
        bundling: {
          externalModules: ['aws-sdk'],
          minify: false,
        },
        environment: {
          // Pass the DynamoDB table name as an environment variable
          TABLE_NAME: app_table.tableName,
        },
      }
    );

    // Grant DynamoDB read/write permissions to the Lambda function
    app_table.grantReadWriteData(s3_yt_upload_trigger);

    // Grant S3 read/write permissions to the Lambda function
    s3_yt_upload_bucket.grantReadWrite(s3_yt_upload_trigger);

    // Create an S3 event source for Lambda to trigger on S3 uploads
    const s3PutEventSource = new cdk.aws_lambda_event_sources.S3EventSource(
      s3_yt_upload_bucket,
      {
        events: [cdk.aws_s3.EventType.OBJECT_CREATED],
      }
    );

    // Add the S3 event source trigger to the Lambda function
    s3_yt_upload_trigger.addEventSource(s3PutEventSource);

    // // dead letter queue for yt uploader
    const yt_upload_jobs_dlq = new cdk.aws_sqs.Queue(
      this,
      'yt_upload_jobs_dlq',
      {
        receiveMessageWaitTime: cdk.Duration.seconds(20),
      }
    );
    // );

    // queue for holding yt uploader jobs
    const yt_upload_jobs_queue = new cdk.aws_sqs.Queue(
      this,
      'yt_upload_jobs_queue',
      {
        visibilityTimeout: cdk.Duration.minutes(1),
        queueName: config.YT_JOBS_QUEUE_NAME,
        receiveMessageWaitTime: cdk.Duration.seconds(20),
        encryption: cdk.aws_sqs.QueueEncryption.KMS_MANAGED,
        deadLetterQueue: {
          queue: yt_upload_jobs_dlq,
          maxReceiveCount: 3,
        },
      }
    );

    // fargate cluster to upload to youtube
    const yt_uploader_fargate_cluster = new ecs.Cluster(
      this,
      'yt_uploader_fargate_cluster',
      {
        enableFargateCapacityProviders: true,
        containerInsights: false,
        // vpc,
      }
    );

    //yt jobs SQS as event source mapping ( mapping lambda to the queue )
    const yt_upload_event_source =
      new cdk.aws_lambda_event_sources.SqsEventSource(yt_upload_jobs_queue, {
        batchSize: 1,
      });

    //building the docker image and pushing to ecr to be used as task definition in fargate
    const yt_uploader_image = new DockerImageAsset(this, 'yt_uploader_image', {
      directory: join(__dirname, '..', 'yt-uploader-go-image'),
    });

    // create a task definition with CloudWatch Logs
    const logging = new ecs.AwsLogDriver({
      streamPrefix: 'yt-uploader-node-logs',
      logRetention: cdk.aws_logs.RetentionDays.FOUR_MONTHS,
    });

    //creating the task definition for the fargate cluster
    const yt_uploader_task_definition = new ecs.FargateTaskDefinition(
      this,
      'yt_uploader_task_definition',
      {
        runtimePlatform: {
          cpuArchitecture: ecs.CpuArchitecture.ARM64,
        },
        memoryLimitMiB: 512,
        cpu: 256,
      }
    );

    //adding the container that handles uploads to the task definition
    const upload_container_name = 'yt_uploader';
    yt_uploader_task_definition.addContainer(upload_container_name, {
      image: ecs.ContainerImage.fromDockerImageAsset(yt_uploader_image),
      logging,
      environment: {
        TABLE_NAME: app_table.tableName,
        YT_UPLOADS_S3_BUCKET_NAME: s3_yt_upload_bucket.bucketName,
        GOOGLE_CLIENT_ID: config.GOOGLE_CLIENT_ID,
        GOOGLE_CLIENT_SECRET: config.GOOGLE_CLIENT_SECRET,
      },
    });

    //lambda handler to initiate fargate tasks
    const yt_upload_jobs_poller = new cdk.aws_lambda_nodejs.NodejsFunction(
      this,
      'yt_upload_jobs_poller',
      {
        runtime: cdk.aws_lambda.Runtime.NODEJS_16_X,
        handler: 'handler',
        timeout: cdk.Duration.seconds(30),
        entry: process.env.YT_UPLOAD_JOBS_POLLER_LAMBDA_PATH,
        bundling: {
          externalModules: ['aws-sdk'],
          minify: false,
        },
        environment: {
          YT_UPLOADER_FARGATE_CLUSTER_NAME:
            yt_uploader_fargate_cluster.clusterName,
          YT_UPLOADER_FARGATE_CONTAINER_NAME: upload_container_name,
          YT_UPLOADER_TASK_DEF_ARN:
            yt_uploader_task_definition.taskDefinitionArn,
          PUBLIC_SUBNET_ID_1: config.PUBLIC_SUBNET_ID_1,
          PUBLIC_SUBNET_ID_2: config.PUBLIC_SUBNET_ID_2,
          FARGATE_YT_UPLOADER_SECURITY_GROUP:
            config.FARGATE_YT_UPLOADER_SECURITY_GROUP,
        },
      }
    );

    //Add event source to lambda
    yt_upload_jobs_poller.addEventSource(yt_upload_event_source);

    //permissions for poller for jobs
    app_table.grantReadWriteData(yt_upload_jobs_poller);
    yt_uploader_task_definition.grantRun(yt_upload_jobs_poller);

    //permissions for ecs task
    app_table.grantReadWriteData(yt_uploader_task_definition.taskRole);
    s3_yt_upload_bucket.grantRead(yt_uploader_task_definition.taskRole);
  }
}
//Miscellaneous Code
// Create VPC
// const vpc = new cdk.aws_ec2.Vpc(this, 'esync_vpc', {
//   maxAzs: 1,
//   natGateways: 0,
//   subnetConfiguration: [
//     {
//       cidrMask: 24,
//       name: 'PublicSubnet1',
//       subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
//     },
//     {
//       cidrMask: 24,
//       name: 'PublicSubnet2',
//       subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
//     },
//     {
//       cidrMask: 24,
//       name: 'PublicSubnet3',
//       subnetType: cdk.aws_ec2.SubnetType.PUBLIC,
//     },
//   ],
// });

// Create a security group
// const securityGroup = new cdk.aws_ec2.SecurityGroup(
//   this,
//   'no_inbound_allow_outbound_sg',
//   {
//     vpc,
//     allowAllOutbound: true,
//     allowAllIpv6Outbound: true,
//   }
// );
