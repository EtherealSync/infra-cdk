import * as cdk from 'aws-cdk-lib';
import 'source-map-support/register';
import { CdkEsyncInfraStack } from '../lib/cdkEsyncInfraStack';
import { getConfig } from '../lib/config';

const config = getConfig();

const app = new cdk.App();
new CdkEsyncInfraStack(app, 'CdkEsyncInfraStack', {
  env: { account: config.AWS_ACCOUNT, region: config.REGION },
});
