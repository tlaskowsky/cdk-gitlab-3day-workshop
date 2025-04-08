    // lib/compute-stack.ts (Reading UserData script from external file)
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as ec2 from 'aws-cdk-lib/aws-ec2';
    import * as iam from 'aws-cdk-lib/aws-iam';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as fs from 'fs'; // Import Node.js File System module
    import * as path from 'path'; // Import Node.js Path module

    // Props Interface for Lab 4
    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
      table: dynamodb.ITable;
      inputBucket: s3.IBucket;
    }

    export class ComputeStack extends cdk.Stack {
      constructor(scope: Construct, id: string, props: ComputeStackProps) {
        super(scope, id, props);

        // --- Look up VPC ---
        const vpc = ec2.Vpc.fromLookup(this, 'ImportedVpc', {
          tags: { Name: 'WorkshopVPC' }, isDefault: false,
        });
        console.log(`Found VPC: ${vpc.vpcId}`);

        // --- IAM Role ---
        const ec2Role = new iam.Role(this, 'EC2InstanceRole', {
          assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
          managedPolicies: [
            iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'),
          ],
         });
        // Grant necessary permissions
        props.processingQueue.grantConsumeMessages(ec2Role);
        props.table.grantWriteData(ec2Role);
        props.inputBucket.grantRead(ec2Role);
        ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({
          actions: ['comprehend:DetectSentiment'],
          resources: ['*'],
        }));
        ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({
            actions: ['textract:DetectDocumentText'],
            resources: ['*'],
          }));

        // --- Security Group ---
        const ec2SecurityGroup = new ec2.SecurityGroup(this, 'EC2SecurityGroup', {
          vpc: vpc,
          description: 'Security group for the document processing EC2 instance',
          allowAllOutbound: true,
        });

        // --- EC2 UserData (Read script from file, use sed) ---
        const userData = ec2.UserData.forLinux();

        // *** Read script template content from external file ***
        const scriptTemplatePath = 'scripts/poll_sqs.sh.template'; // Use path relative to project root
        const pollingScriptTemplate = fs.readFileSync(scriptTemplatePath, 'utf8');

        // Add commands to UserData
        userData.addCommands(
            'set -ex', // Exit on error, print commands
            'echo "UserData Update Trigger: $(date)" > /home/ec2-user/userdata_trigger.log',
            // Install tools
            'sudo yum update -y',
            'sudo yum install -y unzip jq',
            'echo "Installing AWS CLI v2..."',
            'curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"',
            'unzip awscliv2.zip',
            'sudo ./aws/install',
            'rm -rf aws awscliv2.zip',
            'echo "AWS CLI installed successfully."',

            // Write the script TEMPLATE using a heredoc
            'echo "Creating polling script template..."',
            // Write the content read from the file into the heredoc
            `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template
${pollingScriptTemplate}
EOF`,

            // Use sed to replace placeholders with actual values from CDK tokens
            'echo "Replacing placeholders in script..."',
            `sed -e "s|%%QUEUE_URL%%|${props.processingQueue.queueUrl}|g" \\`,
            `    -e "s|%%TABLE_NAME%%|${props.table.tableName}|g" \\`,
            `    /home/ec2-user/poll_sqs.sh.template > /home/ec2-user/poll_sqs.sh`,

            // Set permissions and ownership
            'chmod +x /home/ec2-user/poll_sqs.sh',
            'chown ec2-user:ec2-user /home/ec2-user/poll_sqs.sh',
            'touch /home/ec2-user/sqs_messages.log && chown ec2-user:ec2-user /home/ec2-user/sqs_messages.log',
            'touch /home/ec2-user/poll_sqs.out && chown ec2-user:ec2-user /home/ec2-user/poll_sqs.out',
            'touch /home/ec2-user/userdata_trigger.log && chown ec2-user:ec2-user /home/ec2-user/userdata_trigger.log',
            'touch /home/ec2-user/comprehend_error.log && chown ec2-user:ec2-user /home/ec2-user/comprehend_error.log',
            'touch /home/ec2-user/textract_error.log && chown ec2-user:ec2-user /home/ec2-user/textract_error.log',
            'echo "Polling script created."',

            // Run the script as ec2-user
            'echo "Starting polling script in background..."',
            'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
            'echo "UserData script finished."'
        );

        // --- EC2 Instance Definition (FORCE REPLACEMENT) ---
        // Keep forcing replacement for now until UserData is stable
        const instanceLogicalId = `ProcessingInstance-${Date.now()}`;
        const instance = new ec2.Instance(this, instanceLogicalId, { // Use dynamic logical ID
            vpc: vpc,
            vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
            instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
            machineImage: ec2.MachineImage.latestAmazonLinux2023(),
            securityGroup: ec2SecurityGroup,
            role: ec2Role,
            userData: userData, // Use the updated userData
        });

        // --- Stack Outputs ---
        new cdk.CfnOutput(this, 'InstanceIdOutput', { value: instance.instanceId });
        new cdk.CfnOutput(this, 'LookedUpVpcId', { value: vpc.vpcId });

      } // End of constructor
    } // End of class