import { Handler } from 'aws-lambda';
const AWS = require('aws-sdk');

interface BodyType {
  orgSK: string;
  projectSK: string;
  videoSK: string;
  channelSK: string;
}

interface EventRecord {
  messageId: string;
  receiptHandle: string;
  body: string;
  attributes: {
    ApproximateReceiveCount: string;
    SentTimestamp: string;
    SenderId: string;
    ApproximateFirstReceiveTimestamp: string;
  };
  messageAttributes: Record<string, any>;
  md5OfBody: string;
  eventSource: string;
  eventSourceARN: string;
  awsRegion: string;
}

interface Event {
  Records: EventRecord[];
}

const ecs = new AWS.ECS();

export const handler: Handler = async (event: Event, context) => {
  try {
    const clusterName = process.env.YT_UPLOADER_FARGATE_CLUSTER_NAME as string;
    const taskDefinitionArn = process.env.YT_UPLOADER_TASK_DEF_ARN as string;
    const containerName = process.env
      .YT_UPLOADER_FARGATE_CONTAINER_NAME as string;

    const parsedEnv: BodyType = JSON.parse(event.Records[0].body);

    const customEnvVars = {
      ORG_SK: parsedEnv.orgSK,
      PROJECT_SK: parsedEnv.projectSK,
      VIDEO_SK: parsedEnv.videoSK,
      CHANNEL_SK: parsedEnv.channelSK,
    };

    // Specify any task launch parameters
    const launchParams = {
      cluster: clusterName,
      taskDefinition: taskDefinitionArn,
      launchType: 'FARGATE',
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'ENABLED',
          securityGroups: [process.env.FARGATE_YT_UPLOADER_SECURITY_GROUP],
          subnets: [
            process.env.PUBLIC_SUBNET_ID_1,
            process.env.PUBLIC_SUBNET_ID_2,
          ],
        },
      },
      overrides: {
        containerOverrides: [
          {
            name: containerName,
            environment: Object.entries(customEnvVars).map(([name, value]) => ({
              name,
              value,
            })),
          },
        ],
      },
    };

    // Start the Fargate task
    const response = await ecs.runTask(launchParams).promise();

    // Log the task response
    console.log('ECS Task Response:\n', JSON.stringify(response, null, 2));

    // Return the task ARN or any other relevant information
    return {
      statusCode: 200,
      body: JSON.stringify(response.tasks[0].taskArn),
    };
  } catch (error) {
    console.error('Error starting Fargate task:', error);
    return {
      statusCode: 500,
      body: JSON.stringify('Error starting Fargate task'),
    };
  }
};

// import { DynamoDB, SQS } from 'aws-sdk';
// import { Job } from 'sst/node/job';
// import { Queue } from 'sst/node/queue';

// const sqs = new SQS();
// const dynamodb = new DynamoDB.DocumentClient({region: 'ap-south-1'});

// export async function handler() {
//   try {
//       console.log('Polling SQS queue');

//       const messages = await sqs.receiveMessage({
//         QueueUrl: Queue.queue.queueUrl,
//         MaxNumberOfMessages: 10,
//         WaitTimeSeconds: 20,
//       }).promise();

//       if(!messages.Messages){
//         return {
//           statusCode: 200,
//           body: JSON.stringify({ status: "No messages recieved" }),
//         }
//       }

//       console.log(`Recieved ${messages.Messages.length} messages`);

//       for(const message of messages.Messages){

//           console.log(`Message consumed`);
//           console.log(message)

//           if(message.ReceiptHandle && message.Body){

//             let info;
//             try {
//               info = JSON.parse(message.Body)
//             } catch (error) {
//               return {
//                 statusCode: 400,
//                 body: JSON.stringify({ status: "Bad request, invalid JSON in message body" }),
//               };
//             }

//             if(!info['PARTITION_KEY_TOKEN'] || !info['SORT_KEY_TOKEN'] || !info['PARTITION_KEY_METADATA'] || !info['SORT_KEY_METADATA'] || !info['S3_OBJECT_KEY'] || !info['S3_BUCKET_NAME']){
//                 return {
//                   statusCode: 400,
//                   body: JSON.stringify({ status: "Bad request, check message body" }),
//                 }
//             }

//             const channel_data =  await dynamodb.query({
//                 TableName: 'ethereal-sync',
//                 KeyConditionExpression: '#pk = :pk AND #sk = :sk',
//                 ExpressionAttributeNames: {
//                   '#pk': 'PK',
//                   '#sk': 'SK',
//                 },
//                 ExpressionAttributeValues: {
//                   ':pk': info['PARTITION_KEY_TOKEN'],
//                   ':sk': info['SORT_KEY_TOKEN'],
//                 },
//             }).promise()

//             const meta_data =  await dynamodb.query({
//                 TableName: 'ethereal-sync',
//                 KeyConditionExpression: '#pk = :pk AND #sk = :sk',
//                 ExpressionAttributeNames: {
//                   '#pk': 'PK',
//                   '#sk': 'SK',
//                 },
//                 ExpressionAttributeValues: {
//                   ':pk': info['PARTITION_KEY_METADATA'],
//                   ':sk': info['SORT_KEY_METADATA'],
//                 },
//             }).promise()

//             if(!channel_data.Items || !meta_data.Items){
//               return {
//                 statusCode: 400,
//                 body: JSON.stringify({ status: "Dynamo db query returned null, check logs" }),
//               }
//             }

//             Job.upload.run({
//               payload: {
//                 'ACCESS_TOKEN': channel_data.Items[0]['accessToken'],
//                 'REFRESH_TOKEN' : channel_data.Items[0]['refreshToken'],
//                 'BUCKET_NAME' : info['S3_BUCKET_NAME'],
//                 'OBJECT_KEY' : info['S3_OBJECT_KEY'],
//                 'TITLE' : meta_data.Items[0]['videoTitle'],
//                 'DESCRIPTION' : meta_data.Items[0]['videoDescription']
//               }
//             })

//             await sqs.deleteMessage({
//               QueueUrl: Queue.queue.queueUrl,
//               ReceiptHandle: message.ReceiptHandle
//             }).promise()
//           }
//       }
//       return {
//         statusCode: 200,
//         body: JSON.stringify({ status: "successful" }),
//       }

//   } catch (error) {
//     console.error(error)
//     return {
//       statusCode: 500,
//       body: JSON.stringify({ status: "Unhandled server error, check logs" }),
//     }
//   }

// };
