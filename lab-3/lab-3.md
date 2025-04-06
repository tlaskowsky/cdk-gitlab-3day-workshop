---
layout: default
title: Lab 3 Hands-on Instructions
nav_order: 31
has_children: true
---

# Lab 3: AI (Comprehend) + DynamoDB + Custom Resource Seeding**

## Goal

Add a DynamoDB table for storing results, update the EC2 instance script to call Amazon Comprehend for sentiment analysis and write results to the table, and implement a Custom Resource to seed the table with initial data during deployment.

## Prerequisites

* Completion of Lab 2 (Single-Account version). Your project deploys successfully to Dev with prefixing.
* Local environment configured.

## Step 1: Add Dependencies**

* While CDK v2 bundles most libraries into `aws-cdk-lib`, custom resources often benefit from specific types. Let's ensure necessary types and potentially the SDK v3 client for Lambda (though CDK might bundle v2 for inline) are considered. For now, the core library should suffice for the CDK constructs, and we'll use AWS CLI in the EC2 script. Ensure `aws-cdk-lib` is up-to-date.

    ```bash
    # Run in your local project directory
    npm install aws-cdk-lib@latest constructs@latest # Or yarn add ...
    # Optional: If writing complex inline Lambda needing types
    # npm install --save-dev @types/aws-lambda
    ```

## Step 2: Define DynamoDB Table in Core Stack**

1.  **Open `lib/core-stack.ts`**.
2.  **Import DynamoDB module:** Add `import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';` at the top.
3.  **Define Table Property:** Add a public readonly property for the table within the `CoreStack` class definition:

    ```typescript
    export class CoreStack extends cdk.Stack {
      public readonly bucket: s3.Bucket;
      public readonly queue: sqs.Queue;
      public readonly table: dynamodb.Table; // <<< ADD THIS LINE
      // ... constructor ...
    }
    ```
4.  **Create Table:** Inside the constructor, after the SQS queue definition, add the code to create the DynamoDB table. We'll use `jobId` (a string) as the partition key.

    ```typescript
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
        // pointInTimeRecovery: true,
      });

      // --- Stack Outputs (Add Table Name) ---
      new cdk.CfnOutput(this, 'ResultsTableName', {
        value: this.table.tableName,
        description: 'Name of the DynamoDB table for results',
      });
    ```

## Step 3: Implement Custom Resource for Seeding**

We'll add a Custom Resource to `CoreStack` that runs an inline Lambda function to put a sample item into the table when the stack is created or updated.

1.  Open `lib/core-stack.ts`.
2.  Add Imports:** Add imports for `custom_resources`, `lambda`, and `iam`.
    ```typescript
    import * as custom_resources from 'aws-cdk-lib/custom-resources';
    import * as lambda from 'aws-cdk-lib/aws-lambda';
    import * as iam from 'aws-cdk-lib/aws-iam';
    // import * as path from 'path'; // Not needed for inline
    ```
3.  dd Custom Resource Logic:** Inside the constructor, after the DynamoDB table definition, add the following:
    ```typescript
      // Inside CoreStack constructor, after table definition

      // --- Custom Resource for DDB Seeding ---
      // Define the inline Lambda code (Node.js)
      // This uses AWS SDK v2 syntax which is often bundled with CDK Custom Resource providers
      // Getting table name from environment variable passed by Provider
      const seedingLambdaCode = `
        const AWS = require('aws-sdk');
        const ddb = new AWS.DynamoDB.DocumentClient();
        exports.handler = async (event, context) => {
          console.log('Event:', JSON.stringify(event, null, 2));
          const tableName = process.env.TABLE_NAME;
          if (!tableName) { throw new Error('TABLE_NAME environment variable not set'); }
          // Only run on Create and Update events
          if (event.RequestType === 'Create' || event.RequestType === 'Update') {
            const params = {
              TableName: tableName,
              Item: {
                jobId: event.ResourceProperties.SeedJobId || 'seed-job-001', // Use property or default
                status: 'SEED_DATA',
                timestamp: new Date().toISOString(),
                details: 'This item was added by the CDK Custom Resource Seeder.'
              }
            };
            try {
              console.log('Putting seed item:', params.Item);
              await ddb.put(params).promise();
              console.log('Seed item added successfully.');
            } catch (error) {
              console.error('Error putting seed item:', error);
              // Optionally throw error to fail deployment, or just log
              // throw error;
            }
          } else {
            console.log('RequestType is Delete, skipping seeding.');
          }
          // Signal success back to CloudFormation (important!)
          // Response object structure depends slightly on provider used, but typically needs Status & PhysicalResourceId
          // For the basic Provider, returning nothing on success is often okay for non-UpdateReplace actions.
          // Returning a PhysicalResourceId is generally required.
          return { PhysicalResourceId: event.ResourceProperties.SeedJobId || context.logStreamName };
        };
      `;

      // Create the Custom Resource Provider (manages the Lambda function)
      const seederProvider = new custom_resources.Provider(this, 'DDBSeedProvider', {
        onEventHandler: new lambda.Function(this, 'DDBSeedHandler', {
          runtime: lambda.Runtime.NODEJS_18_X, // Choose appropriate runtime
          handler: 'index.handler',
          code: lambda.Code.fromInline(seedingLambdaCode),
          timeout: cdk.Duration.minutes(1),
          environment: {
            TABLE_NAME: this.table.tableName, // Pass table name to Lambda
          },
        }),
        // logRetention: logs.RetentionDays.ONE_WEEK, // Optional: Configure log retention
      });

      // Grant the Lambda function permissions to write to the table
      this.table.grantWriteData(seederProvider.onEventHandler);

      // Create the Custom Resource itself, triggering the provider
      new cdk.CustomResource(this, 'DDBSeedResource', {
        serviceToken: seederProvider.serviceToken,
        properties: {
          // You can pass properties to the Lambda here if needed
          SeedJobId: `seed-item-${this.stackName}`, // Example property
          // Add a timestamp or random element to ensure resource updates on code change
          Timestamp: Date.now().toString()
        }
      });
    ```

## Step 4: Update Compute Stack & UserData**

1.  Open `lib/compute-stack.ts`.
2.  Import DynamoDB:** Add `import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';`
3.  Update Props Interface:** Add the table property to `ComputeStackProps`:
    ```typescript
    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
      table: dynamodb.ITable; // <<< ADD THIS LINE (use ITable interface)
    }
    ```
4.  Grant Permissions:** Inside the constructor, after granting SQS permissions, grant the EC2 role permissions to write to the DynamoDB table and call Comprehend. You'll need the `iam` import (`import * as iam from 'aws-cdk-lib/aws-iam';`).
    ```typescript
      // Inside ComputeStack constructor, after SQS grant
      // Grant DDB write permissions
      props.table.grantWriteData(ec2Role);

      // Grant Comprehend permissions
      ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['comprehend:DetectSentiment'], // Add other actions if needed later
        resources: ['*'], // Comprehend actions are typically not resource-specific
      }));
    ```
5.  Modify UserData Script:** Update the `pollingScript` definition to include calls to Comprehend and DynamoDB using the AWS CLI.
    ```typescript
      // Inside ComputeStack constructor

      // Define the script content using a template literal.
      const pollingScript = `#!/bin/bash
        echo "Polling SQS Queue: ${props.processingQueue.queueUrl} (Region determined automatically by AWS CLI)"
        while true; do
        # Receive message (note: no delete yet!)
        REC_MSG=$(/usr/local/bin/aws sqs receive-message --queue-url ${props.processingQueue.queueUrl} --wait-time-seconds 10 --max-number-of-messages 1)
        MSG_BODY=$(echo $REC_MSG | jq -r '.Messages[0].Body') # Extract body
        MSG_ID=$(echo $REC_MSG | jq -r '.Messages[0].MessageId') # Extract message ID

        # Check if a message was received
        if [ -n "$MSG_BODY" ] && [ "$MSG_BODY" != "null" ]; then
            echo "Received message ID: $MSG_ID"
            echo "Body: $MSG_BODY"

            # --- Call Comprehend ---
            # Use dummy text for now, replace with extracted text later (from S3/Textract)
            # Max 5000 bytes for DetectSentiment. Ensure text is UTF-8.
            TEXT_TO_ANALYZE="It is raining today in Seattle" # Replace with "$MSG_BODY" if body is plain text
            # Need to handle potential quotes/special chars in TEXT_TO_ANALYZE if using MSG_BODY directly
            echo "Running sentiment analysis..."
            # Use command substitution and ensure errors are handled or logged
            SENTIMENT_RESULT=$(aws comprehend detect-sentiment --language-code en --text "$TEXT_TO_ANALYZE" 2> /home/ec2-user/comprehend_error.log)
            SENTIMENT=$(echo $SENTIMENT_RESULT | jq -r '.Sentiment // "ERROR"') # Default to ERROR if parsing fails
            SENTIMENT_SCORE_POSITIVE=$(echo $SENTIMENT_RESULT | jq -r '.SentimentScore.Positive // "0"') # Default to 0

            echo "Sentiment: $SENTIMENT (Positive Score: $SENTIMENT_SCORE_POSITIVE)"

            # --- Write to DynamoDB ---
            TABLE_NAME="${props.table.tableName}" # CDK token resolved here
            JOB_ID="job-${MSG_ID}" # Use Message ID to create a unique Job ID
            TIMESTAMP=$(date --iso-8601=seconds) # Get current timestamp

            echo "Writing results to DynamoDB table: $TABLE_NAME"
            # Construct JSON item for put-item. Use variables defined above.
            # Ensure proper JSON formatting and escaping if needed, especially for text body
            # Using jq to construct the JSON safely
            ITEM_JSON=$(jq -n --arg jobId "$JOB_ID" --arg ts "$TIMESTAMP" --arg status "PROCESSED" --arg sentiment "$SENTIMENT" --arg scorePos "$SENTIMENT_SCORE_POSITIVE" --arg msgBody "$MSG_BODY" '{
            "jobId": {"S": $jobId},
            "timestamp": {"S": $ts},
            "status": {"S": $status},
            "sentiment": {"S": $sentiment},
            "sentimentScorePositive": {"N": $scorePos},
            "messageBody": {"S": $msgBody}
            }')

            # Use AWS CLI to put the item, check for errors
            aws dynamodb put-item --table-name $TABLE_NAME --item "$ITEM_JSON"
            if [ $? -eq 0 ]; then
                echo "Results written to DynamoDB."
            else
                echo "ERROR writing to DynamoDB."
            fi

            # Append simple confirmation to local log (optional)
            echo "Processed message ID: $MSG_ID at $TIMESTAMP" >> /home/ec2-user/sqs_messages.log

        else
            echo "No message received."
            # If no message, loop continues after sleep
        fi

        # Pause between polls
        sleep 5
        done`;

      // The rest of the UserData.addCommands block remains the same:
      // ... (set -ex, trigger log, installs, cat <<'EOF', chmod, chown, run script) ...
    ```
    > **Note:** Added basic error handling/defaults for Comprehend/DDB calls. Switched DDB item construction to use `jq` for better JSON safety. Error logging for Comprehend goes to a separate file.

## Step 5: Update App Entry Point

1.  Open `bin/<your-project-name>.ts`.
2.  Pass Table to ComputeStack:** Modify the `ComputeStack` instantiation to pass the `table` object from `CoreStack`.

    ```typescript
      // Inside bin/app.ts

      // --- Instantiate Stacks with Prefixed IDs ---
      console.log('Instantiating CoreStack...');
      const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

      console.log('Instantiating ComputeStack...');
      const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
        ...deploymentProps,
        processingQueue: coreStack.queue,
        table: coreStack.table, // <<< ADD THIS LINE
      });

      // --- Apply Aspects --- (remains the same)
      // ...
    ```

## Step 6: Deploy and Verify

1.  Commit and Push: Save all changes (`lib/core-stack.ts`, `lib/compute-stack.ts`, `bin/app.ts`), commit, and push to GitLab.
    ```bash
    git add .
    git commit -m "Lab 3: Add DDB, Comprehend, Custom Resource Seeder"
    git push origin main
    ```
2.  Monitor Dev Pipeline:*Watch the pipeline execute in GitLab. Ensure all stages pass. The `deploy_dev` stage will update `CoreStack` and `ComputeStack`.
3.  Check CloudFormation: Verify stack updates completed successfully in the AWS console. Look for the new DynamoDB table and the Lambda function created for the Custom Resource.
4.  Verify DDB Table & Seed Data:
    * Go to the DynamoDB console in your Dev region.
    * Find the table named `${prefix}-CoreStack-ProcessingResultsTable...`.
    * Click on the table and go to "Explore table items".
    * You should see at least one item with `jobId` like `seed-item-${prefix}-CoreStack` and `status: SEED_DATA`, created by the Custom Resource.
5.  Test End-to-End Flow:
    * Send Manual SQS Message: Go to the SQS console, find your `${prefix}-CoreStack-DocumentProcessingQueue...` queue, and send a test message. The body can be simple text for now (e.g., `{"file": "test.txt", "text": "This is a test document."}`).
    * Check EC2 Logs (Optional): Connect to the EC2 instance via Session Manager. You can `tail -f /home/ec2-user/sqs_messages.log` to see the "Processed message ID..." confirmation. Check `cat /home/ec2-user/poll_sqs.out` for any errors from the script loop. Check `/home/ec2-user/comprehend_error.log` for Comprehend errors.
    * Verify DDB Item: Go back to the DynamoDB table items. Refresh the view. You should see a *new* item with a `jobId` like `job-<sqs-message-id>`. Examine the item - it should contain attributes like `timestamp`, `status: PROCESSED`, `sentiment: NEUTRAL` (or similar based on the dummy text), `sentimentScorePositive`, and the `messageBody` you sent.

## tep 7: Clean Up Resources

* Run the `cdk destroy` command for the Dev environment as described in Lab 2, Step 5, using the correct prefix and context flags. This will delete the stacks, including the DynamoDB table (due to `removalPolicy: DESTROY`).
    ```bash
    # Destroy Dev Environment
    # Replace YOUR_FULL_DEV_PREFIX, AWS_ACCOUNT_ID (Dev), and AWS_DEFAULT_REGION (Dev) below.
    npx cdk destroy --all -c prefix=YOUR_FULL_DEV_PREFIX -c environment=dev -c account=AWS_ACCOUNT_ID -c region=AWS_DEFAULT_REGION
    ```

---

## Congratulations!

You have successfully integrated DynamoDB for persistence, added AI analysis using Amazon Comprehend, and implemented a CDK Custom Resource to automate database seeding during deployment!