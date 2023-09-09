import { Handler } from 'aws-lambda';
const AWS = require('aws-sdk');

const ecs = new AWS.ECS();

export const handler: Handler = async (event, context) => {
  console.log('EVENT: \n' + JSON.stringify(event, null, 2));
  try {
    // Define your cluster name and task definition ARN
    const clusterName = process.env.YT_UPLOADER_FARGATE_CLUSTER_NAME as string;
    const taskDefinitionArn = process.env.YT_UPLOADER_TASK_DEF_ARN as string;

    // Specify any task launch parameters
    const launchParams = {
      cluster: clusterName,
      taskDefinition: taskDefinitionArn,
      launchType: 'FARGATE', // Use Fargate launch type
      networkConfiguration: {
        awsvpcConfiguration: {
          assignPublicIp: 'ENABLED',
          securityGroups: [process.env.FARGATE_YT_UPLOADER_SECURITY_GROUP],
          subnets: [process.env.PUBLIC_SUBNET_1, process.env.PUBLIC_SUBNET_2],
        },
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
