import * as dotenv from 'dotenv';
import path = require('path');

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export type ConfigProps = {
  GOOGLE_CLIENT_ID: string;
  GOOGLE_CLIENT_SECRET: string;
  AWS_ACCOUNT: string;
  REGION: string;
  TABLE_NAME: string;
  BUCKET_NAME: string;
  YT_JOBS_QUEUE_NAME: string;
  S3_UPLOAD_TRIGGER_LAMBDA_PATH: string;
  YT_UPLOAD_JOBS_POLLER_LAMBDA_PATH: string;
  PUBLIC_SUBNET_ID_1: string;
  PUBLIC_SUBNET_ID_2: string;
  FARGATE_YT_UPLOADER_SECURITY_GROUP: string;
};

export const getConfig = (): ConfigProps => ({
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID as string,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET as string,
  AWS_ACCOUNT: process.env.AWS_ACCOUNT as string,
  REGION: process.env.REGION as string,
  TABLE_NAME: process.env.TABLE_NAME as string,
  BUCKET_NAME: process.env.BUCKET_NAME as string,
  YT_JOBS_QUEUE_NAME: process.env.YT_JOBS_QUEUE_NAME as string,
  S3_UPLOAD_TRIGGER_LAMBDA_PATH: process.env
    .S3_UPLOAD_TRIGGER_LAMBDA_PATH as string,
  YT_UPLOAD_JOBS_POLLER_LAMBDA_PATH: process.env
    .YT_UPLOAD_JOBS_POLLER_LAMBDA_PATH as string,
  PUBLIC_SUBNET_ID_1: process.env.PUBLIC_SUBNET_ID_2 as string,
  PUBLIC_SUBNET_ID_2: process.env.PUBLIC_SUBNET_ID_2 as string,
  FARGATE_YT_UPLOADER_SECURITY_GROUP: process.env
    .FARGATE_YT_UPLOADER_SECURITY_GROUP as string,
});
