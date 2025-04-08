    // lib/compute-stack.ts (Reading UserData script from external file)
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import * as iam from 'aws-cdk-lib/aws-iam';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
    import * as s3 from 'aws-cdk-lib/aws-s3';
    //import * as fs from 'fs'; // Import Node.js File System module
    //import * as path from 'path'; // Import Node.js Path module
    import * as ecs from 'aws-cdk-lib/aws-ecs';
    import * as ecr from 'aws-cdk-lib/aws-ecr';
    import * as ecs_patterns from 'aws-cdk-lib/aws-ecs-patterns';
    import * as logs from 'aws-cdk-lib/aws-logs';

    // Props Interface for Lab 5
    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
      table: dynamodb.ITable;
      inputBucket: s3.IBucket;
      ecrRepoName: string;
    }

    export class ComputeStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

          // Inside ComputeStack constructor - REPLACING EC2 logic

          // --- Look up VPC --- (Keep this, but import ec2 at top level)
          const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', { tags: { Name: 'WorkshopVPC' } });

          // --- ECS Cluster ---
          const cluster = new ecs.Cluster(this, 'ProcessingCluster', { vpc: vpc, clusterName: `${id}-Cluster` });

          // --- Reference ECR Repo ---
          const ecrRepo = ecr.Repository.fromRepositoryName(this, 'EcrRepo', props.ecrRepoName);

          // --- Define Log Group for Fargate Task ---
          const logGroup = new logs.LogGroup(this, 'FargateLogGroup', {
              logGroupName: `/ecs/${id}-FargateService`,
              removalPolicy: cdk.RemovalPolicy.DESTROY,
          });

          // --- Queue Processing Fargate Service ---
          const fargateService = new ecs_patterns.QueueProcessingFargateService(this, 'QueueProcessingService', {
            cluster: cluster,
            memoryLimitMiB: 1024, // Increased
            cpu: 512, // Increased
            image: ecs.ContainerImage.fromEcrRepository(ecrRepo, 'latest'),
            queue: props.processingQueue,
            environment: {
              TABLE_NAME: props.table.tableName,
              AWS_REGION: this.region,
              QUEUE_URL: props.processingQueue.queueUrl
            },
            maxScalingCapacity: 2,
            minScalingCapacity: 0,
            logDriver: ecs.LogDrivers.awsLogs({ streamPrefix: 'doc-processor', logGroup: logGroup }),
          });

          // --- Grant Additional Permissions to Fargate Task Role ---
          props.table.grantWriteData(fargateService.taskDefinition.taskRole);
          props.inputBucket.grantRead(fargateService.taskDefinition.taskRole);
          fargateService.taskDefinition.taskRole.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['comprehend:DetectSentiment', 'textract:DetectDocumentText'],
            resources: ['*'],
          }));

          // --- Stack Outputs ---
          new cdk.CfnOutput(this, 'EcsClusterName', { value: cluster.clusterName });
          new cdk.CfnOutput(this, 'FargateServiceName', { value: fargateService.service.serviceName });
          new cdk.CfnOutput(this, 'FargateLogGroupName', { value: logGroup.logGroupName });
          new cdk.CfnOutput(this, 'LookedUpVpcId', { value: vpc.vpcId });

      } // End of constructor
    } // End of class