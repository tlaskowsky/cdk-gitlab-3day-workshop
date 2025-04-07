---
layout: default
title: Lab 5 Hands-on Instructions
nav_order: 51
has_children: true
sitemap: false
published: false
nav_exclude: true  # Many Jekyll themes use this
---

# Lab 5: Automated Tests + Monitoring + Aspects

## Goal

Add Jest unit/snapshot tests, implement a CDK Aspect for DynamoDB PITR compliance validation and tagging (to satisfy a hypothetical SCP), enable PITR, add CloudWatch/SNS monitoring, and integrate tests into CI/CD.

## Prerequisites

* Completion of Lab 4. Your project deploys successfully to Dev with prefixing and the full S3->SQS->EC2->Textract->Comprehend->DDB pipeline working. Code should match final state from Lab 4 (artifacts `lab4_bin_app_final`, `lab4_script_template_final`, `lab4_compute_stack_final`, `lab4_core_stack_final`).
* Local environment configured.
* *(Instructor Info)* Assume an SCP is active in the AWS account denying `dynamodb:CreateTable`/`UpdateTable` unless the resource request includes the tag `PITR-Enabled: true`.

---

## Step 1: Setup Jest Testing

1.  **Install Dev Dependencies:** Run this in your local project terminal:
    ```bash
    npm install --save-dev jest @types/jest ts-jest
    # Or using yarn:
    # yarn add --dev jest @types/jest ts-jest
    ```
2.  **Configure Jest:** Create a `jest.config.js` file in your project root with the following content:
    ```javascript
    // jest.config.js
    module.exports = {
      testEnvironment: 'node',
      roots: ['<rootDir>/test'], // Point Jest to the 'test' directory
      testMatch: ['**/*.test.ts'], // Look for files ending in .test.ts
      transform: {
        '^.+\\.tsx?$': 'ts-jest' // Use ts-jest to handle TypeScript files
      }
    };
    ```
3.  **Add Test Script:** Open `package.json` and ensure the `test` script under `"scripts"` is set to `"jest"`:
    ```json
    {
      // ... other package.json content ...
      "scripts": {
        "build": "tsc",
        "watch": "tsc -w",
        "test": "jest", // <<< Ensure this line exists/is correct
        "cdk": "cdk"
      },
      // ... dependencies ...
    }
    ```

---

## Step 2: Write Unit & Snapshot Tests (`test/core-stack.test.ts`)

Let's write tests for the `CoreStack`.

1.  **Create/Modify Test File:** CDK `init` usually creates a basic test file (e.g., `test/<your-project-name>.test.ts`). Rename or use this file as `test/core-stack.test.ts`. Create the `test` directory if it doesn't exist.
2.  **Add Imports:** Add/ensure you have these imports at the top:
    ```typescript
    import * as cdk from 'aws-cdk-lib';
    import { Template, Match } from 'aws-cdk-lib/assertions';
    // Import the specific stack you are testing
    import { CoreStack } from '../lib/core-stack'; // Adjust the path if your file structure is different
    ```
3.  **Write Test Suite:** Replace the existing test content (or create new content) with the following Jest structure:
    ```typescript
    // test/core-stack.test.ts

    describe('CoreStack Tests', () => {
      let app: cdk.App;
      let stack: CoreStack;
      let template: Template;

      beforeAll(() => {
        // GIVEN a CDK App
        app = new cdk.App({
          // Provide context required by the stack and app entry point, using dev defaults
          context: {
            prefix: 'test-prefix-dev', // Use a fixed test prefix
            environment: 'dev',
            account: '111122223333', // Dummy account/region for synthesis
            region: 'us-east-1'
          }
        });
        // WHEN CoreStack is synthesized
        // Stack names need the prefix from context now
        const stackId = `${app.node.tryGetContext('prefix')}-CoreStack`;
        stack = new CoreStack(app, stackId, {
          env: {
            account: app.node.tryGetContext('account'),
            region: app.node.tryGetContext('region')
          }
        });
        // Synthesize the stack to a CloudFormation template
        template = Template.fromStack(stack);
      });

      // Test 1: Resource Counts
      test('Should create required core resources', () => {
        template.resourceCountIs('AWS::S3::Bucket', 1);
        template.resourceCountIs('AWS::SQS::Queue', 1);
        template.resourceCountIs('AWS::DynamoDB::Table', 1);
        // Check for the Lambda function used by the custom resource provider
        // Note: NodejsFunction creates multiple Lambda resources (handler + role)
        // Let's check for the handler specifically by its logical ID pattern
        template.resourceCountIs('AWS::Lambda::Function', 1); // Expecting 1 handler function
        // Check for the Custom Resource itself
        template.resourceCountIs('AWS::CloudFormation::CustomResource', 1);
      });

      // Test 2: S3 Bucket Properties
      test('S3 Bucket should have versioning and encryption enabled', () => {
        template.hasResourceProperties('AWS::S3::Bucket', {
          VersioningConfiguration: {
            Status: 'Enabled'
          },
          BucketEncryption: {
            ServerSideEncryptionConfiguration: Match.arrayWith([
              Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } })
            ])
          },
          PublicAccessBlockConfiguration: Match.objectLike({
            BlockPublicAcls: true,
            BlockPublicPolicy: true,
            IgnorePublicAcls: true,
            RestrictPublicBuckets: true
          })
        });
      });

      // Test 3: SQS Queue Properties
      test('SQS Queue should have SSE enabled and allow S3 notifications', () => {
        template.hasResourceProperties('AWS::SQS::Queue', {
          SqsManagedSseEnabled: true // Check for default SSE-SQS
        });
        template.hasResourceProperties('AWS::SQS::QueuePolicy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Action: "sqs:SendMessage",
                Effect: "Allow",
                Principal: { Service: "s3.amazonaws.com" },
              })
            ])
          }
        });
      });

      // Test 4: DynamoDB Table Properties (Initial - PITR Disabled)
      test('DynamoDB Table should have PAY_PER_REQUEST billing and PITR disabled initially', () => {
        template.hasResourceProperties('AWS::DynamoDB::Table', {
          BillingMode: 'PAY_PER_REQUEST',
          // Check that PointInTimeRecoverySpecification is ABSENT initially
          // This assumes the starting code for Lab 5 does NOT have PITR enabled yet.
           PointInTimeRecoverySpecification: Match.absent()
        });
      });

      // Test 5: Snapshot Test
      test('Core Stack should match snapshot', () => {
        // Convert the template to JSON and compare with stored snapshot
        expect(template.toJSON()).toMatchSnapshot();
      });

    }); // End describe block
    ```
    > **Note:** Adjust assertions (especially for DynamoDB PITR initial state) based on your actual code state at the beginning of Lab 5.

4.  **Run Initial Tests & Snapshot:**
    * Run `npm test` in your terminal.
    * The snapshot test will fail initially. Run `npm test -- -u` (or `npm test -- --updateSnapshot`) to create the initial `.snap` file in `test/__snapshots__/`.
    * Review the snapshot file. Commit it (`git add test/__snapshots__/*`).
    * Fix any failing unit tests based on your starting code.

---

## Step 3: Implement Compliance Aspect

Create a CDK Aspect to validate DynamoDB PITR is enabled and apply the `PITR-Enabled: true` tag required by the SCP.

1.  **Create `lib/compliance-aspect.ts`:** Create this new file in the `lib` directory.
2.  **Add Aspect Code:** Paste the following code into the file.
    ```typescript
    // lib/compliance-aspect.ts
    import * as cdk from 'aws-cdk-lib';
    import { IConstruct } from 'constructs';
    import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

    export class ComplianceAspect implements cdk.IAspect {
      public visit(node: IConstruct): void {
        // Check if the node is a DynamoDB Table L2 construct
        if (node instanceof dynamodb.Table) {
          // Access the underlying CloudFormation resource properties
          // Need to escape the stack scope to access the Cfn resource
          const cfnTable = node.node.defaultChild as dynamodb.CfnTable;

          // Check if PITR property is explicitly enabled in the Cfn resource definition
          const pitrEnabled = cfnTable.pointInTimeRecoverySpecification?.pointInTimeRecoveryEnabled;

          if (pitrEnabled === true) {
            // If enabled, add the compliance tag required by the SCP
            cdk.Tags.of(node).add('PITR-Enabled', 'true');
            cdk.Annotations.of(node).addInfo('PITR is enabled and tagged for compliance.');
          } else {
            // If not explicitly enabled, add a CDK synthesis error to fail the build/synth
            cdk.Annotations.of(node).addError('Compliance Error: DynamoDB Point-in-Time Recovery (PITR) must be enabled in the CDK code!');
          }
        }
        // Add other compliance checks here if desired
      }
    }
    ```

---

## Step 4: Enable PITR & Apply Aspect

Now, make your `CoreStack` compliant and apply the Aspect.

1.  **Enable PITR:** Open `lib/core-stack.ts`. Find the `dynamodb.Table` definition and **ensure** PITR is enabled by setting `pointInTimeRecovery: true`.
    ```typescript
      // Inside CoreStack constructor
      this.table = new dynamodb.Table(this, 'ProcessingResultsTable', {
        partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        pointInTimeRecovery: true, // <<< ENSURE THIS IS SET TO TRUE
      });
    ```
2.  **Apply Aspect:** Open `bin/<your-project-name>.ts`. Import the new aspect and apply it to the app scope *after* applying the `BasicTagger`.
    ```typescript
    // bin/app.ts
    // ... other imports ...
    import { ComplianceAspect } from '../lib/compliance-aspect'; // <<< Import Compliance Aspect

    // ... app definition, context reading, stack instantiations ...

    // --- Apply Aspects ---
    console.log('Applying aspects for tagging and compliance...');
    cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
    cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
    cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
    // *** APPLY NEW ASPECT ***
    cdk.Aspects.of(app).add(new ComplianceAspect()); // <<< Apply Compliance Aspect
    console.log('Tagging and Compliance aspects applied.');
    ```

---

## Step 5: Run Tests & Synth Locally

Verify the tests pass and the Aspect works correctly.

1.  **Run Tests:** Open your local terminal in the project root.
    ```bash
    npm test
    ```
    * The snapshot test will fail again because enabling PITR and applying the Aspect (which adds a tag) changed the template. Update the snapshot:
      ```bash
      npm test -- -u
      ```
    * The unit test checking the initial PITR state (`DynamoDB Table should have... PITR disabled initially`) should now fail. Update the assertion in `test/core-stack.test.ts` to expect PITR to be enabled and the tag to be present:
      ```typescript
      // In test/core-stack.test.ts
      test('DynamoDB Table should have PITR Enabled and Tagged', () => { // Renamed test
        template.hasResourceProperties('AWS::DynamoDB::Table', {
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } // <<< Check for TRUE
        });
        // Also check if the compliance tag was added by the aspect
        template.hasResourceProperties('AWS::DynamoDB::Table', {
           Tags: Match.arrayWith([
             { Key: 'PITR-Enabled', Value: 'true' }
           ])
        });
      });
      ```
    * Re-run `npm test` to ensure all tests pass.

2.  **Run Synth:** Synthesize the template locally, providing necessary context. Check Aspect messages.
    ```bash
    # Replace with your actual Dev context values
    npx cdk synth -c prefix=stuXX-dev -c environment=dev -c account=DEV_ACCOUNT_ID -c region=DEV_REGION
    ```
    * You should **not** see the `Compliance Error` anymore.
    * You should see the `[Info] PITR is enabled and tagged for compliance.` message associated with the table resource in the CDK output/log.
    * Examine the synthesized template in `cdk.out/stuXX-dev-CoreStack.template.json`. Verify the `AWS::DynamoDB::Table` resource has both `PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }` and the `PITR-Enabled: true` tag.

---

## Step 6: Add Monitoring (CloudWatch Alarm & SNS Topic)

Add monitoring for the SQS queue depth to `CoreStack`.

1.  **Open `lib/core-stack.ts`**.
2.  **Add Imports:** Add imports for `cloudwatch`, `cloudwatch_actions`, `sns`, `sns_subscriptions`.
    ```typescript
    import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
    import * as cw_actions from 'aws-cdk-lib/aws-cloudwatch-actions';
    import * as sns from 'aws-cdk-lib/aws-sns';
    import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
    ```
3.  **Add Monitoring Resources:** Inside the constructor, add the following code (e.g., before the CfnOutputs):
    ```typescript
      // Inside CoreStack constructor

      // --- Monitoring & Alerting ---
      // Create an SNS Topic for notifications
      const alarmTopic = new sns.Topic(this, 'AlarmTopic');

      // Add an email subscription (replace with your email)
      // You will need to confirm the subscription via email after deployment
      alarmTopic.addSubscription(new subs.EmailSubscription('YOUR_EMAIL@example.com')); // <<< REPLACE EMAIL

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

      // Output SNS Topic ARN
      new cdk.CfnOutput(this, 'AlarmTopicArn', { value: alarmTopic.topicArn });
    ```
    > **Action Required:** Replace `YOUR_EMAIL@example.com` with your actual email address.

---

## Step 7: Update CI/CD Pipeline

Integrate the tests into the build stage of your CI/CD pipeline.

1.  **Open `.gitlab-ci.yml`**.
2.  **Modify `build_cdk` Job:** Add the `npm test` command to the `script:` block *after* `npm run build` and `npx cdk synth`.
    ```yaml
    build_cdk:
      stage: build
      # ... (image, tags, cache) ...
      script: |
        echo "Installing dependencies..."
        npm ci
        echo "Building TypeScript code..."
        npm run build
        echo "Synthesizing CloudFormation template..."
        if [ -z "$AWS_ACCOUNT_ID" ] || [ -z "$AWS_DEFAULT_REGION" ]; then exit 1; fi
        npx cdk synth --all -c account=${AWS_ACCOUNT_ID} -c region=${AWS_DEFAULT_REGION}
        echo "Running unit tests..."
        npm test # <<< ADD THIS LINE
      # ... (artifacts, rules) ...
    ```

---

## Step 8: Deploy and Verify

1.  **Commit and Push:** Save all changes (`lib/*`, `bin/*`, `test/*`, `package.json`, `package-lock.json`, `jest.config.js`, `.gitlab-ci.yml`), commit, and push. **Make sure to `git add test/` and `git add jest.config.js`!**
    ```bash
    git add .
    git commit -m "Lab 5: Add Tests, Monitoring, and Compliance Aspect"
    git push origin main
    ```
2.  **Monitor Pipeline:** Watch the pipeline in GitLab.
    * Verify the `build_cdk` job now runs `npm test` and passes.
    * Verify the `deploy_dev` job succeeds. The SCP check for the DDB tag should pass because the Aspect added it during synth.
3.  **Confirm SNS Subscription:** Check your email for a subscription confirmation message from AWS Notification. Click the confirmation link. You won't receive alarm emails until you confirm.
4.  **Verify Monitoring & Compliance:**
    * Go to the **CloudWatch console** -> Alarms. Find the alarm named `${prefix}-CoreStack-QueueDepthAlarm`. Its initial state should be OK or Insufficient Data.
    * Go to the **DynamoDB console** -> Tables -> Select your table -> Tags tab. Verify the `PITR-Enabled: true` tag is present. Check the Backups tab - Point-in-time recovery should be enabled.
5.  **Test Alarm (Optional):**
    * Send 6 or more messages quickly to your SQS queue (e.g., using the AWS Console Send Message feature repeatedly).
    * Wait a few minutes (allow for evaluation periods).
    * Check the CloudWatch Alarm state - it should transition to `ALARM`.
    * Check your email - you should receive an alarm notification from SNS (if you confirmed the subscription).
    * (The EC2 instance will eventually process these messages).

---

## Step 9: Clean Up Resources

* Run `cdk destroy` for the Dev environment as described previously. This will delete the stacks, including the SNS topic and CloudWatch alarm.

---

## Congratulations!

You have enhanced your IaC practice by adding automated unit/snapshot tests, implemented proactive compliance checks using CDK Aspects that integrate with organizational policies (SCPs), and added basic monitoring and alerting for your pipeline!