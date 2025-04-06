---
layout: default
title: Lab 3 Hands-on Instructions
nav_order: 31
has_children: true
---

# Lab 3: AI (Comprehend) + DynamoDB + Custom Resource Seeding


## Goal

Add a DynamoDB table for storing results, update the EC2 instance script to call Amazon Comprehend and write results to the table, and implement a Custom Resource (using AWS SDK v3 and the `NodejsFunction` construct) to seed the table with initial data during deployment.

## Prerequisites

* Completion of Lab 2 (Single-Account version). Your project deploys successfully to Dev with prefixing.
* Local environment configured (Node, CDK, Git, AWS Creds for Dev).
* `esbuild` installed locally OR available in your build environment (`npm install -D esbuild` or `yarn add -D esbuild`).

## Step 1: Add Dependencies

1.  **Install AWS SDK v3 Clients:** Run the following command in your local project directory's terminal to install the necessary SDK v3 clients for DynamoDB, which will be used by the seeder Lambda.
    ```bash
    npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
    # Or using yarn:
    # yarn add @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
    ```
2.  **Install Lambda Types:** Run the following command to install the type definitions needed for the Lambda handler code.
    ```bash
    npm install --save-dev @types/aws-lambda
    # Or using yarn:
    # yarn add --dev @types/aws-lambda
    ```
3.  **Ensure CDK library is up-to-date:**
    ```bash
    npm install aws-cdk-lib@latest constructs@latest
    # Or yarn add ...
    ```

## Step 2: Define DynamoDB Table in Core Stack

1.  **Open `lib/core-stack.ts`**.
2.  **Import DynamoDB module:** Add `import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';` at the top.
3.  **Define Table Property:** Add `public readonly table: dynamodb.Table;` within the `CoreStack` class definition.
4.  **Create Table:** Inside the constructor, after the SQS queue definition, add the code to create the DynamoDB table.
    ```typescript
      // Inside CoreStack constructor, after SQS queue definition

      // --- DynamoDB Table ---
      this.table = new dynamodb.Table(this, 'ProcessingResultsTable', {
        partitionKey: { name: 'jobId', type: dynamodb.AttributeType.STRING },
        billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      // --- Stack Outputs (Add Table Name) ---
      new cdk.CfnOutput(this, 'ResultsTableName', {
        value: this.table.tableName,
        description: 'Name of the DynamoDB table for results',
      });
    ```

## Step 3: Create Lambda Handler for Seeding (SDK v3)

1.  **Create Lambda Directory:** In the **root** of your CDK project, create a new directory named `lambda`.
2.  **Create Handler File:** Inside the `lambda` directory, create a new file named `seed-ddb.ts`.
3.  **Add Handler Code:** Paste the following TypeScript code into `lambda/seed-ddb.ts`. This uses the AWS SDK v3 syntax and includes error handling.
    ```typescript
    // lambda/seed-ddb.ts
    import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
    import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
    // Import the specific type needed from aws-lambda
    import type { CloudFormationCustomResourceEvent, Context } from 'aws-lambda';

    // Initialize DDB Document Client with default region from environment
    const client = new DynamoDBClient({});
    const ddbDocClient = DynamoDBDocumentClient.from(client);

    export const handler = async (event: CloudFormationCustomResourceEvent, context: Context) => {
      console.log('Event:', JSON.stringify(event, null, 2));
      const tableName = process.env.TABLE_NAME; // Get table name from environment
      if (!tableName) {
        throw new Error('TABLE_NAME environment variable not set');
      }

      // Use SeedJobId from properties or generate one using LogicalResourceId
      const physicalResourceId = event.ResourceProperties?.SeedJobId || `seed-item-${event.LogicalResourceId}`;

      try {
        // Only run on Create and Update events
        if (event.RequestType === 'Create' || event.RequestType === 'Update') {
          const params = {
            TableName: tableName,
            Item: {
              jobId: physicalResourceId, // Use PhysicalResourceId as JobId for seed item
              status: 'SEED_DATA',
              timestamp: new Date().toISOString(),
              details: 'This item was added by the CDK Custom Resource Seeder (SDK v3).'
            }
          };

          console.log('Putting seed item:', params.Item);
          await ddbDocClient.send(new PutCommand(params));
          console.log('Seed item added successfully.');

        } else { // RequestType === 'Delete'
          console.log('RequestType is Delete, skipping seeding/deletion.');
          // No action needed on delete for this simple seeder
        }

        // Return success response to CloudFormation
        // PhysicalResourceId should be stable for updates/deletes
        return { PhysicalResourceId: physicalResourceId, Data: {} };

      } catch (error) {
        console.error('Error processing event:', error);
        // Safely access error message and rethrow to fail deployment
        const errorMessage = (error instanceof Error) ? error.message : String(error);
        throw new Error(`Failed to seed DynamoDB table: ${errorMessage}`);
      }
    };
    ```

## Step 4: Implement Custom Resource using NodejsFunction

Update `CoreStack` to use the `NodejsFunction` construct to deploy the handler file.

1.  **Open `lib/core-stack.ts`**.
2.  **Add/Update Imports:** Ensure imports for `custom_resources`, `lambda`, `iam`, and add `lambda_nodejs`. **Remove** the `path` import if it exists.
    ```typescript
    import * as cdk from 'aws-cdk-lib';
    import { Construct } from 'constructs';
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
    import * as custom_resources from 'aws-cdk-lib/custom-resources';
    import * as lambda from 'aws-cdk-lib/aws-lambda';
    import * as lambda_nodejs from 'aws-cdk-lib/aws-lambda-nodejs'; // Ensure this is imported
    // import * as iam from 'aws-cdk-lib/aws-iam';
    // import * as path from 'path'; // REMOVE THIS if present
    ```
3.  **Replace Custom Resource Logic:** Inside the constructor, after the DynamoDB table definition, **replace** any previous Custom Resource logic with the following:
    ```typescript
      // Inside CoreStack constructor, after table definition
      // --- Custom Resource for DDB Seeding (Using NodejsFunction) ---

      // Define the NodejsFunction - CDK handles bundling SDK v3 dependencies
      const seedHandler = new lambda_nodejs.NodejsFunction(this, 'DDBSeedHandler', {
        runtime: lambda.Runtime.NODEJS_18_X, // Or NODEJS_20_X
        entry: 'lambda/seed-ddb.ts', // Path relative to project root (where cdk.json is)
        handler: 'handler', // Function name in the handler file
        timeout: cdk.Duration.minutes(1),
        environment: {
          TABLE_NAME: this.table.tableName, // Pass table name to Lambda
        },
        bundling: { // Optional: Configure bundling options if needed
          minify: false, // Easier debugging
        },
      });

      // Grant the Lambda function permissions to write to the table
      this.table.grantWriteData(seedHandler);

      // Create the Custom Resource Provider using the NodejsFunction
      const seederProvider = new custom_resources.Provider(this, 'DDBSeedProvider', {
        onEventHandler: seedHandler, // Reference the NodejsFunction
      });

      // Create the Custom Resource itself, triggering the provider
      new cdk.CustomResource(this, 'DDBSeedResource', {
        serviceToken: seederProvider.serviceToken,
        properties: {
          // Pass properties to the Lambda if needed (used for PhysicalResourceId here)
          SeedJobId: `seed-item-${this.stackName}`, // Example property
          // Add a changing property to ensure the resource updates when code/props change
          Timestamp: Date.now().toString()
        }
      });
    ```

## Step 5: Update Compute Stack & UserData

1.  **Open `lib/compute-stack.ts`**.
2.  **Verify Imports:** Ensure `dynamodb` and `iam` are imported.
3.  **Verify Props Interface:** Ensure `table: dynamodb.ITable;` is present.
4.  **Verify Permissions:** Ensure `props.table.grantWriteData(ec2Role);` and the `comprehend:DetectSentiment` policy statement are present.
5.  **Update UserData Script:** **Replace** the `pollingScriptTemplate` constant definition with the following **corrected version** that does *not* escape the shell dollar signs (`$`).
    ```typescript
      // Inside ComputeStack constructor

      // Define the script TEMPLATE with PLACEHOLDERS and NO escaped $.
      const pollingScriptTemplate = `#!/bin/bash
      echo "Polling SQS Queue: %%QUEUE_URL%% (Region determined automatically by AWS CLI)"
      # Assign resolved values to shell variables
      QUEUE_URL="%%QUEUE_URL%%"
      TABLE_NAME="%%TABLE_NAME%%"

      while true; do
        # Receive message using shell variable $QUEUE_URL
        REC_MSG=$(aws sqs receive-message --queue-url "$QUEUE_URL" --wait-time-seconds 10 --max-number-of-messages 1)
        # Use shell variables $REC_MSG etc. (NO backslashes)
        MSG_BODY=$(echo "$REC_MSG" | jq -r '.Messages[0].Body')
        MSG_ID=$(echo "$REC_MSG" | jq -r '.Messages[0].MessageId')

        # Check if a message was received using shell variable $MSG_BODY
        if [ -n "$MSG_BODY" ] && [ "$MSG_BODY" != "null" ]; then
          echo "Received message ID: $MSG_ID"
          echo "Body: $MSG_BODY"

          # --- Call Comprehend ---
          TEXT_TO_ANALYZE="It is raining today in Seattle" # Replace with "$MSG_BODY" if body is plain text
          echo "Running sentiment analysis..."
          SENTIMENT_RESULT=$(aws comprehend detect-sentiment --language-code en --text "$TEXT_TO_ANALYZE" 2> /home/ec2-user/comprehend_error.log)
          SENTIMENT=$(echo "$SENTIMENT_RESULT" | jq -r '.Sentiment // "ERROR"')
          SENTIMENT_SCORE_POSITIVE=$(echo "$SENTIMENT_RESULT" | jq -r '.SentimentScore.Positive // "0"')

          echo "Sentiment: $SENTIMENT (Positive Score: $SENTIMENT_SCORE_POSITIVE)"

          # --- Write to DynamoDB ---
          JOB_ID="job-${MSG_ID}" # Use shell variable $MSG_ID
          TIMESTAMP=$(date --iso-8601=seconds)

          echo "Writing results to DynamoDB table: $TABLE_NAME"
          # Construct JSON item for put-item using jq and shell variables
          ITEM_JSON=$(jq -n --arg jobId "$JOB_ID" --arg ts "$TIMESTAMP" --arg status "PROCESSED" --arg sentiment "$SENTIMENT" --arg scorePos "$SENTIMENT_SCORE_POSITIVE" --arg msgBody "$MSG_BODY" '{
            "jobId": {"S": $jobId},
            "timestamp": {"S": $ts},
            "status": {"S": $status},
            "sentiment": {"S": $sentiment},
            "sentimentScorePositive": {"N": $scorePos},
            "messageBody": {"S": $msgBody}
          }')

          # Use AWS CLI to put the item using shell variable $TABLE_NAME
          aws dynamodb put-item --table-name "$TABLE_NAME" --item "$ITEM_JSON"
          # Check exit status (using $?)
          if [ $? -eq 0 ]; then
              echo "Results written to DynamoDB."
          else
              echo "ERROR writing to DynamoDB."
          fi

          # Append simple confirmation to local log (optional)
          echo "Processed message ID: $MSG_ID at $TIMESTAMP" >> /home/ec2-user/sqs_messages.log

        else
          echo "No message received."
        fi

        # Pause between polls
        sleep 5
      done`;

      // Ensure the rest of the UserData.addCommands block uses the heredoc + sed method
      userData.addCommands(
          'set -ex',
          'echo "UserData Update Trigger: $(date)" > /home/ec2-user/userdata_trigger.log',
          // ... installs ...
          'echo "Creating polling script template..."',
          `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template
${pollingScriptTemplate}
EOF`,
          'echo "Replacing placeholders in script..."',
          `sed -e "s|%%QUEUE_URL%%|${props.processingQueue.queueUrl}|g" \\`,
          `    -e "s|%%TABLE_NAME%%|${props.table.tableName}|g" \\`,
          `    /home/ec2-user/poll_sqs.sh.template > /home/ec2-user/poll_sqs.sh`,
          'chmod +x /home/ec2-user/poll_sqs.sh',
          // ... chown/touch ...
          'echo "Polling script created."',
          'echo "Starting polling script in background..."',
          'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
          'echo "UserData script finished."'
      );
    ```

## Step 6: Update App Entry Point

*(No changes needed in this step compared to the previous version - just ensure it matches)*

1.  **Open `bin/<your-project-name>.ts`**.
2.  **Verify Table Prop:** Ensure `ComputeStack` instantiation passes `table: coreStack.table`.

## Step 7: Deploy and Verify

1.  **Install Dependencies (if not already done):**
    ```bash
    npm install @aws-sdk/client-dynamodb @aws-sdk/lib-dynamodb
    npm install --save-dev @types/aws-lambda
    npm install --save-dev esbuild # If not installed globally/in CI
    ```
2.  **Commit and Push:** Save all changes (`lib/core-stack.ts`, `lib/compute-stack.ts`, `bin/app.ts`, `lambda/seed-ddb.ts`, `package.json`, `package-lock.json`), commit, and push to GitLab.
    ```bash
    git add .
    git commit -m "Lab 3: Final - Use NodejsFunction for Seeder, sed for UserData"
    git push origin main
    ```
3.  **Monitor Dev Pipeline:** Watch the pipeline execute. Check the `build_cdk` job log for `esbuild` output. Ensure all stages pass.
4.  **Check CloudFormation & DDB Seed Data:** Verify stack updates and check for the seed item in DynamoDB.
5.  **Test End-to-End Flow:** Send a test SQS message. Check the DynamoDB table again - a new item should appear with `status: PROCESSED` and Comprehend results. Check EC2 logs if needed.

**Step 8: Clean Up Resources**

* Run `cdk destroy` for the Dev environment as described previously.

---

## Congratulations!

You have successfully integrated DynamoDB, added Comprehend analysis, and implemented a robust CDK Custom Resource using the `NodejsFunction` construct and AWS SDK v3 for database seeding!
