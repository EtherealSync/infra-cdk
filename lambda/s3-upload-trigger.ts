import { Handler, S3Event, S3EventRecord } from 'aws-lambda';
import { DynamoDB, S3 } from 'aws-sdk';
export type Project = {
  PK: string;
  SK: string;
  userId?: string;
  name?: string;
  createdAt: number;
};

export type Channel = {
  SK: string;
  name?: string;
  subscriberCount?: number;
  profileImageUrl?: string;
  //below values will never be returned to frontend, only required in api route
  issuedAt?: number;
  scope?: string;
  refreshToken?: string;
  expiresIn?: string;
  tokenType?: string;
};

export enum StatusType {
  AwaitingApproval = 'awaiting_approval',
  Rejected = 'rejected',
  UploadedToYT = 'uploaded_to_yt',
  Failed = 'failed',
}

export type Video = {
  PK: string;
  SK: string;
  videoDescription: string;
  videoTitle: string;
  userId: string;
  uploadedToPlatformAt: number;
  uploadedToYoutubeAt?: number;
  status: StatusType;
  src?: string;
};

interface Metadata {
  orgid?: string;
  projectid?: string;
  userid?: string;
  videotitle?: string;
  videodescription?: string;
  thumbnailkey?: string;
  contenttype?: string;
}

const dynamoDB = new DynamoDB.DocumentClient();
const s3 = new S3();

export const handler: Handler = async (event: S3Event, context) => {
  try {
    const key = event.Records[0].s3.object.key;

    // Extract metadata from S3 object header
    const metadata: Metadata = await getObjectMetadata(event.Records[0]);

    // Check if the content type starts with "video"
    if (metadata.contenttype === 'video') {
      // Create a record in DynamoDB with status "CreatedRecord" and metadata
      await createRecordInDynamoDB(
        metadata.orgid,
        metadata.projectid,
        key,
        StatusType.AwaitingApproval,
        metadata
      );
    }

    return {
      statusCode: 200,
      body: JSON.stringify('Data saved'),
    };
  } catch (error) {
    console.error('Error processing S3 event:', error);
    return {
      statusCode: 500,
      body: JSON.stringify('Error processing S3 event'),
    };
  }
};

const getObjectMetadata = async (s3Record: S3EventRecord) => {
  const bucket = s3Record.s3.bucket.name;
  const key = s3Record.s3.object.key;

  const params = {
    Bucket: bucket,
    Key: key,
  };

  const headObjectResponse = await s3.headObject(params).promise();
  return headObjectResponse.Metadata || {};
};

const createRecordInDynamoDB = async (
  orgId: string | undefined,
  projectId: string | undefined,
  videoKey: string,
  status: StatusType,
  metadata: Metadata
) => {
  const params = {
    TableName: process.env.TABLE_NAME as string,
    Item: {
      PK: `ORG#${orgId || ''}#PROJECT#${projectId || ''}`,
      SK: `VIDEO#${videoKey}`,
      uploadedToPlatformAt: new Date().getTime(),
      status: status,
      userId: metadata.userid || null,
      videoTitle: metadata.videotitle || null,
      videoDescription: metadata.videodescription || null,
      thumbnailKey: metadata.thumbnailkey || null,
    } as Video,
  };
  await dynamoDB.put(params).promise();
};
