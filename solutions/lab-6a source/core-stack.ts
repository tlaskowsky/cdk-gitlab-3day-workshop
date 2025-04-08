// lib/core-stack.ts
import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as custom_resources from 'aws-cdk-lib/custom-resources';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs';
import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as ecr from 'aws-cdk-lib/aws-ecr';

export class CoreStack extends cdk.Stack {
  public readonly bucket: s3.Bucket;
  public readonly queue: sqs.Queue;
  public readonly table: dynamodb.Table;
  public readonly ecrRepo: ecr.Repository;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // S3 bucket for document uploads -
    this.bucket = new s3.Bucket(this, 'DocumentInputBucket', {
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      encryption: s3.BucketEncryption.S3_MANAGED,
      versioned: true,
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
    });

    // SQS queue for processing tasks
    this.queue = new sqs.Queue(this, 'DocumentProcessingQueue', {
      encryption: sqs.QueueEncryption.SQS_MANAGED,
    });

    // --- S3 Event Notification to SQS ---
    // Configure the bucket to send a message to the queue for specific events
    this.bucket.addEventNotification(
      // Event type: Trigger when any object is created
      s3.EventType.OBJECT_CREATED,
      // Destination: Our SQS queue
      new s3n.SqsDestination(this.queue),
      // Optional Filters: Only trigger for specific prefixes or suffixes
      // Example: Only trigger for PDFs uploaded to an 'uploads/' folder
      // { prefix: 'uploads/', suffix: '.pdf' }
      // For this lab, let's trigger for any PDF upload anywhere in the bucket:
      { suffix: '.pdf' }
    );
    // Note: The SqsDestination construct automatically adds the necessary
    // permissions to the queue policy allowing S3 to send messages.


    // Inside CoreStack constructor, after SQS queue definition
    // --- DynamoDB Table ---
    this.table = new dynamodb.Table(this, 'ProcessingResultsTable', {
      // Define the primary key (Partition Key only in this case)
      partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
      // Use On-Demand (Pay-Per-Request) billing - good for unpredictable workloads/workshops
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      // Ensure table is deleted when stack is destroyed (for workshop cleanup)
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Optional: Enable Point-in-Time Recovery (good practice for production)
      pointInTimeRecovery: true,
    });

    // Inside CoreStack constructor, after table definition
    // --- Custom Resource for DDB Seeding (Using NodejsFunction) ---
    // Define the NodejsFunction - CDK handles bundling SDK v3 dependencies
    const seedHandler = new lambda_nodejs.NodejsFunction(this, 'DDBSeedHandler', {
      runtime: lambda.Runtime.NODEJS_18_X, // Or NODEJS_20_X
      entry: 'lambda/seed-ddb.ts', // Use path relative to project root
      handler: 'handler', // Function name in the handler file
      timeout: cdk.Duration.minutes(1),
      environment: {
        TABLE_NAME: this.table.tableName, // Pass table name to Lambda
      },
      bundling: { // Optional: Configure bundling options if needed
        minify: false, // Easier debugging
        externalModules: [
          // '@aws-sdk/lib-dynamodb', // Usually included by default if imported
          // '@aws-sdk/client-dynamodb', // Usually included by default if imported
        ],
      },
    });

    // Grant the Lambda function permissions to write to the table
    this.table.grantWriteData(seedHandler);

    // Create the Custom Resource Provider using the NodejsFunction
    const seederProvider = new custom_resources.Provider(this, 'DDBSeedProvider', {
      onEventHandler: seedHandler, // Reference the NodejsFunction
      // logRetention: logs.RetentionDays.ONE_WEEK, // Optional
    });

    // Create the Custom Resource itself, triggering the provider
    new cdk.CustomResource(this, 'DDBSeedResource', {
      serviceToken: seederProvider.serviceToken,
      properties: {
        // Pass properties to the Lambda if needed (used for PhysicalResourceId here)
        SeedJobId: `seed-item-${this.stackName}`, // Example property
        // Add a changing property to ensure the resource updates when code/props change
        // Timestamp: Date.now().toString()
      }
    });

    // --- Monitoring & Alerting ---
    // Create an SNS Topic for notifications
    const alarmTopic = new sns.Topic(this, 'AlarmTopic');

    // Add an email subscription (replace with your email)
    // You will need to confirm the subscription via email after deployment
    alarmTopic.addSubscription(new subs.EmailSubscription('tlaskowsky@gmail.com')); 

    // Create a CloudWatch Metric for the SQS queue depth (visible messages)
    const queueDepthMetric = this.queue.metricApproximateNumberOfMessagesVisible({
      period: cdk.Duration.minutes(1), // Check every minute
      statistic: 'Maximum', // Use the maximum value over the period
    });

    // Create a CloudWatch Alarm based on the metric
    const queueDepthAlarm = new cloudwatch.Alarm(this, 'QueueDepthAlarm', {
      alarmName: `${this.stackName}-QueueDepthAlarm`, // Include stack name for uniqueness
      alarmDescription: 'Alarm if SQS queue depth exceeds threshold',
      metric: queueDepthMetric,
      threshold: 5, // Trigger if 5 or more messages are waiting
      evaluationPeriods: 2, // Trigger if threshold breached for 2 consecutive periods (2 minutes)
      comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING, // Treat missing data as OK
    });

    // Add an action to notify the SNS topic when the alarm state is reached
    queueDepthAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

    // Inside CoreStack constructor
    const prefix = this.node.tryGetContext('prefix') || `stu20-${this.node.tryGetContext('environment') || 'dev'}`;

    // --- ECR Repository ---
    this.ecrRepo = new ecr.Repository(this, 'ProcessingAppRepo', {
      repositoryName: `${prefix}-processor-repo`.toLowerCase(),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteImages: true,
      imageScanOnPush: true,
    });

    // Output Repository URI
    new cdk.CfnOutput(this, 'EcrRepoUri', { value: this.ecrRepo.repositoryUri });


    // Output SNS Topic ARN
    new cdk.CfnOutput(this, 'AlarmTopicArn', { value: alarmTopic.topicArn });

    // Outputs for easy reference
    new cdk.CfnOutput(this, 'InputBucketName', { value: this.bucket.bucketName });
    new cdk.CfnOutput(this, 'ProcessingQueueUrl', { value: this.queue.queueUrl });
    new cdk.CfnOutput(this, 'ProcessingQueueArn', { value: this.queue.queueArn });
    // --- Stack Outputs (Add Table Name) ---
    new cdk.CfnOutput(this, 'ResultsTableName', { value: this.table.tableName, description: 'Name of the DynamoDB table for results',});
  }
}
