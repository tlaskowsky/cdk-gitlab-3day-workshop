---
layout: default
title: Lab 5 Hands-on Instructions
nav_order: 51
has_children: true
---

## Lab 5: Automated Tests + Monitoring + Aspects

## Goal

Add Jest unit/snapshot tests, implement a CDK Aspect for DynamoDB PITR compliance validation, enable PITR and apply the required tag, add CloudWatch/SNS monitoring, and integrate tests into CI/CD.

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

Let's write initial tests for the `CoreStack`. These will likely fail later and need updating.

1.  **Create/Modify Test File:** Ensure `test/core-stack.test.ts` exists in the `test/` directory at your project root. Create the directory if needed.
2.  **Add Imports:** Add/ensure you have these imports at the top:
    ```typescript
    import * as cdk from 'aws-cdk-lib';
    import { Template, Match } from 'aws-cdk-lib/assertions';
    import { CoreStack } from '../lib/core-stack';
    // We will add imports for Aspects later when setting up the test scope properly
    ```
3.  **Write Test Suite:** Replace the existing test content (or create new content) with the following Jest structure:
    ```typescript
    // test/core-stack.test.ts
    describe('CoreStack Tests', () => {
      let app: cdk.App;
      let stack: CoreStack;
      let template: Template;

      // Note: We will update this beforeAll later to apply Aspects
      beforeAll(() => {
        // GIVEN a CDK App with context
        app = new cdk.App({
          context: {
            prefix: 'test-prefix-dev',
            environment: 'dev',
            account: '111122223333',
            region: 'us-east-1'
          }
        });
        // WHEN CoreStack is synthesized
        const stackId = `${app.node.tryGetContext('prefix')}-CoreStack`;
        stack = new CoreStack(app, stackId);
        template = Template.fromStack(stack); // Synthesize BEFORE applying aspects for initial tests
      });

      // Test 1: Resource Counts
      test('Should create required core resources', () => {
        template.resourceCountIs('AWS::S3::Bucket', 1);
        template.resourceCountIs('AWS::SQS::Queue', 1);
        template.resourceCountIs('AWS::DynamoDB::Table', 1);
        template.resourceCountIs('AWS::CloudFormation::CustomResource', 1); // Check for Custom Resource
      });

      // Test 2: S3 Bucket Properties
      test('S3 Bucket should have versioning and encryption enabled', () => {
        template.hasResourceProperties('AWS::S3::Bucket', {
          VersioningConfiguration: { Status: 'Enabled' },
          BucketEncryption: { ServerSideEncryptionConfiguration: Match.arrayWith([ Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }) ]) },
          PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true })
        });
      });

      // Test 3: SQS Queue Properties
      test('SQS Queue should have SSE enabled and allow S3 notifications', () => {
        template.hasResourceProperties('AWS::SQS::Queue', {
          SqsManagedSseEnabled: true // Check for default SSE-SQS
        });
        // Check only essential parts of the Queue Policy Statement
        template.hasResourceProperties('AWS::SQS::QueuePolicy', {
          PolicyDocument: {
            Statement: Match.arrayWith([
              Match.objectLike({
                Effect: "Allow",
                Principal: { Service: "s3.amazonaws.com" },
                Action: Match.arrayWith(["sqs:SendMessage"]), // Check Action array contains SendMessage
                Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("DocumentProcessingQueue"), "Arn"] }
              })
            ])
          }
        });
      });

        // Test 4: DynamoDB Table Properties (Assertion updated below)
        test('DynamoDB Table should have PITR Enabled and Tagged', () => {
          template.hasResourceProperties('AWS::DynamoDB::Table', {
            BillingMode: 'PAY_PER_REQUEST',
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } // Check PITR enabled
          });
          template.hasResourceProperties('AWS::DynamoDB::Table', {
            Tags: Match.arrayWith([ // Check Tag applied
              { Key: 'PITR-Enabled', Value: 'true' }
            ])
          });
        });

      // Test 5: Snapshot Test
      test('Core Stack should match snapshot', () => {
        expect(template.toJSON()).toMatchSnapshot();
      });

    }); // End describe block
    ```
4.  **Run Initial Tests & Snapshot:**
    * Run `npm test`. Some tests might pass, the snapshot test will fail.
    * Run `npm test -- -u` to create the initial snapshot based on the Lab 4 code state (where PITR is likely disabled).
    * Commit the new snapshot file (`test/__snapshots__/core-stack.test.ts.snap`).

---

## Step 3: Implement Compliance Aspect (Validation Only)

Create a CDK Aspect to **validate** DynamoDB PITR is enabled and apply the `PITR-Enabled: true` tag required by the SCP.

1.  **Create `lib/compliance-aspect.ts`:** Create this new file in the `lib` directory.
2.  **Add Aspect Code:** Paste the following **corrected code** into the file. This version checks the Cfn property existence and uses the Cfn resource's tag manager.

    ```typescript
        // lib/compliance-aspect.ts (Corrected PITR Check - Existence Check v2)
        import * as cdk from 'aws-cdk-lib';
        import { IConstruct } from 'constructs';
        import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';

        export class ComplianceAspect implements cdk.IAspect {
          public visit(node: IConstruct): void {
            // Check if the node is a DynamoDB Table L2 construct
            if (node instanceof dynamodb.Table) {
              // Access the underlying CloudFormation resource (L1 construct)
              const cfnTable = node.node.defaultChild as dynamodb.CfnTable;

              // *** CORRECTED CHECK: Check for the existence of the specification property ***
              // If 'pointInTimeRecovery: true' was set on the L2 Table construct,
              // CDK should synthesize the 'pointInTimeRecoverySpecification' property.
              if (cfnTable.pointInTimeRecoverySpecification) {
                // If the specification property exists, assume PITR is enabled and add the tag.
                cfnTable.tags.setTag('PITR-Enabled', 'true'); // Use CfnTable's tag manager
                cdk.Annotations.of(node).addInfo('PITR specification found; Tagged for compliance.');
              } else {
                // If the specification property is absent, PITR is likely disabled. Add error.
                cdk.Annotations.of(node).addError('Compliance Error: DynamoDB Point-in-Time Recovery (PITR) must be enabled in the CDK code! (Set pointInTimeRecovery: true)');
              }
            }
            // Add other compliance checks here if desired
          }
        }
    ```

---

## Step 4: Enable PITR, Apply Aspect, and Apply Tag

Make the `CoreStack` compliant, apply the validation Aspect, and add the required tag separately.

1.  **Update `lib/tagging-aspect.ts`:** Open the `BasicTagger` file (created in Lab 1) and replace its content with this version that uses Cfn tagging:
    ```typescript
        // lib/tagging-aspect.ts (Use Cfn Tagging)
        import * as cdk from 'aws-cdk-lib';
        import { IConstruct } from 'constructs';

        export class BasicTagger implements cdk.IAspect {
            private readonly key: string;
            private readonly value: string;
            constructor(key: string, value: string | undefined) { // Allow undefined from tryGetContext
                this.key = key;
                this.value = value ?? ''; // Default to empty string if undefined
                if (value === undefined || value === null) {
                console.warn(`BasicTagger: Value for tag key '${key}' was undefined or null.`);
                }
            }

            public visit(node: IConstruct): void {
                // Use the CfnResource Tags API if possible
                if (node instanceof cdk.CfnResource && typeof node.tags === 'object' && typeof node.tags.setTag === 'function') {
                node.tags.setTag(this.key, this.value);
                }
                // Optional Fallback (unlikely needed for core resources):
                // else if (cdk.TagManager.isTaggable(node)) {
                //    cdk.Tags.of(node).add(this.key, this.value);
                // }
            }
        }
    ```
2.  **Enable PITR:** Open `lib/core-stack.ts`. Find the `dynamodb.Table` definition and **ensure** PITR is enabled by setting `pointInTimeRecovery: true`. Also ensure the `Timestamp` property was removed from the `CustomResource` definition (as done in previous troubleshooting).
    ```typescript
      // Inside CoreStack constructor
      this.table = new dynamodb.Table(this, 'ProcessingResultsTable', {
        // ... other props ...
        pointInTimeRecovery: true, // <<< ENSURE THIS IS SET TO TRUE
      });
      // Ensure CustomResource does NOT have Timestamp property
      new cdk.CustomResource(this, 'DDBSeedResource', {
        serviceToken: seederProvider.serviceToken,
        properties: { SeedJobId: `seed-item-${this.stackName}` }
      });
    ```
3.  **Apply Aspects:** Open `bin/<your-project-name>.ts`. Ensure `ComplianceAspect` and `BasicTagger` are imported and applied correctly **with priority** for `ComplianceAspect`. Ensure the direct tag line is **removed**.
    
    ```typescript
        // bin/app.ts
        // ... imports ...
        import { ComplianceAspect } from '../lib/compliance-aspect';
        import { BasicTagger } from '../lib/tagging-aspect';

        // ... app definition, context reading ...
        const deploymentProps = { /* ... env ... */ };

        // --- Instantiate Stacks ---
        const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);
        const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, { /* ... props ... */ });

        // --- Apply Aspects ---
        console.log('Applying aspects for tagging and compliance...');
        // Apply BasicTagger instances (default priority 0)
        cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
        cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
        cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
        // Apply ComplianceAspect with higher priority (lower number)
        cdk.Aspects.of(app).add(new ComplianceAspect(), { priority: 10 }); // Apply with priority
        console.log('Tagging and Compliance aspects applied.');

        // --- Apply Required Tag Directly ---
        // cdk.Tags.of(coreStack.table).add('PITR-Enabled', 'true'); // <<< ENSURE THIS IS REMOVED
    ```


---

## Step 5: Run Tests & Synth Locally

Verify the tests pass and the Aspect/Tagging works correctly.

1.  **Update Test Setup (`beforeAll`):** Open `test/core-stack.test.ts`. Ensure the `beforeAll` block applies **all** Aspects (`BasicTagger` instances and `ComplianceAspect` with priority) **before** calling `Template.fromStack`.
    ```typescript
        // test/core-stack.test.ts
        // ... imports ...
        import { BasicTagger } from '../lib/tagging-aspect';
        import { ComplianceAspect } from '../lib/compliance-aspect';

        describe('CoreStack Tests', () => {
        let app: cdk.App;
        let stack: CoreStack;
        let template: Template;

        beforeAll(() => {
            app = new cdk.App({ /* ... context ... */ });
            const prefix = app.node.tryGetContext('prefix');
            const environment = app.node.tryGetContext('environment');
            const stackId = `${prefix}-CoreStack`;
            stack = new CoreStack(app, stackId); // Instantiate stack

            // Apply Aspects BEFORE synthesis
            cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
            cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
            cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
            cdk.Aspects.of(app).add(new ComplianceAspect(), { priority: 10 }); // Apply with priority

            template = Template.fromStack(stack); // Synthesize AFTER applying aspects
        });

        // ... (Rest of tests - ensure DDB test checks for PITR and ALL tags) ...
        test('DynamoDB Table should have PITR Enabled and Tagged', () => {
            template.hasResourceProperties('AWS::DynamoDB::Table', {
            PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true }
            });
            // Check ALL tags applied by aspects
            template.hasResourceProperties('AWS::DynamoDB::Table', {
            Tags: Match.arrayWith([
                { Key: 'environment', Value: 'dev' },
                { Key: 'project', Value: 'doc-pipeline-workshop' },
                { Key: 'prefix', Value: 'test-prefix-dev' },
                { Key: 'PITR-Enabled', Value: 'true' }
            ])
            });
        });
        // ...
        });
    ```

2.  **Run Tests:** Open your local terminal and run:
    ```bash
        npm test -- -u
    ```
    * Update the snapshot.
    * All tests should now **pass**. Run `npm test` again without `-u` to confirm.


1.  **Run Synth:** Synthesize the template locally, providing necessary context.
   ```bash
        # Replace with your actual Dev context values
        npx cdk synth -c prefix=stuXX-dev -c environment=dev -c account=DEV_ACCOUNT_ID -c region=DEV_REGION
    ```
    * Verify no `Compliance Error` appears.
    * Check the synthesized template (`cdk.out/...CoreStack.template.json`) for the PITR setting and **all** expected tags on the DynamoDB table.

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
      const alarmTopic = new sns.Topic(this, 'AlarmTopic');
      alarmTopic.addSubscription(new subs.EmailSubscription('YOUR_EMAIL@example.com')); // <<< REPLACE EMAIL

      const queueDepthMetric = this.queue.metricApproximateNumberOfMessagesVisible({
        period: cdk.Duration.minutes(1),
        statistic: 'Maximum',
      });

      const queueDepthAlarm = new cloudwatch.Alarm(this, 'QueueDepthAlarm', {
        alarmName: `${this.stackName}-QueueDepthAlarm`,
        alarmDescription: 'Alarm if SQS queue depth exceeds threshold',
        metric: queueDepthMetric,
        threshold: 5,
        evaluationPeriods: 2,
        comparisonOperator: cloudwatch.ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      });
      queueDepthAlarm.addAlarmAction(new cw_actions.SnsAction(alarmTopic));

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
      # ... (stage, image, tags, cache) ...
      script: |
        # ... (npm ci, npm run build, if check, npx cdk synth) ...
        echo "Running unit tests..."
        npm test # <<< ADD THIS LINE
      # ... (artifacts, rules) ...
    ```

---

## Step 8: Deploy and Verify

1.  **Commit and Push:** Save all changes (`lib/*`, `bin/*`, `test/*`, `package.json`, `package-lock.json`, `jest.config.js`, `.gitlab-ci.yml`), commit (`git add .`, `git commit ...`), and push. **Make sure to `git add test/` and `git add lib/compliance-aspect.ts`!**
    ```bash
    git add .
    git commit -m "Lab 5: Add Tests, Monitoring, and Compliance Aspect"
    git push origin main
    ```
2.  **Monitor Pipeline:** Watch the pipeline in GitLab.
    * Verify the `build_cdk` job now runs `npm test` and passes.
    * Verify the `deploy_dev` job succeeds. The SCP check for the DDB tag should pass because the tag was added in `bin/app.ts`.
3.  **Confirm SNS Subscription:** Check your email for a subscription confirmation message from AWS Notification. Click the confirmation link.
4.  **Verify Monitoring & Compliance:**
    * Go to the **CloudWatch console** -> Alarms. Find the alarm named `${prefix}-CoreStack-QueueDepthAlarm`. Its initial state should be OK or Insufficient Data.
    * Go to the **DynamoDB console** -> Tables -> Select your table -> Tags tab. Verify the `PITR-Enabled: true` tag is present. Check the Backups tab - Point-in-time recovery should be enabled.
5.  **Test Alarm (Optional):**
    * Send 6 or more messages quickly to your SQS queue. Wait a few minutes. Check the CloudWatch Alarm state (should go to `ALARM`). Check your email for the notification (if confirmed).

---

## Step 9: Clean Up Resources

* Run `cdk destroy` for the Dev environment as described previously.

---

## Congratulations!

You have enhanced your IaC practice by adding automated unit/snapshot tests, implemented proactive compliance checks using CDK Aspects that integrate with organizational policies (SCPs), and added basic monitoring and alerting for your pipeline!