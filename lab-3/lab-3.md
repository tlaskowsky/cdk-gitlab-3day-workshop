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
Due to the complexity of the userdata script needed, we will move the polling logic to a separate Bash script.

1. **Create scripts Directory:** in the root of your project:
    ```bash
       mkdir scripts
    ```
2. **Create Script Template File:** Inside the scripts directory, create a file named poll_sqs.sh.template.
3. **Add Bash Script Content:**  Paste the following Bash script (using %%PLACEHOLDERS%% and Lab 3 logic) into scripts/poll_sqs.sh.template:
    ```bash
        #!/bin/bash
        echo "Polling SQS Queue: %%QUEUE_URL%% (Region determined automatically by AWS CLI)"
        # Assign resolved values to shell variables
        QUEUE_URL="%%QUEUE_URL%%"
        TABLE_NAME="%%TABLE_NAME%%"

        while true; do
          echo "Receiving messages..."
          # Receive message
          REC_MSG=$(aws sqs receive-message --queue-url "$QUEUE_URL" --attribute-names All --message-attribute-names All --wait-time-seconds 10 --max-number-of-messages 1)
          MSG_BODY=$(echo "$REC_MSG" | jq -r '.Messages[0].Body // empty')
          MSG_ID=$(echo "$REC_MSG" | jq -r '.Messages[0].MessageId // empty')

          # Check if a message was received
          if [ -n "$MSG_BODY" ] && [ "$MSG_BODY" != "null" ]; then
            echo "Received message ID: $MSG_ID"
            echo "Body: $MSG_BODY"

          # --- Call Comprehend (Lab 3) ---
          # Use MSG_BODY which holds the text from SQS
          # Truncate the actual message body to comply with Comprehend limits (approx 5000 bytes)
            TEXT_TO_ANALYZE_TRUNCATED=$(printf '%s' "$MSG_BODY" | head -c 4999)
            echo "Running sentiment analysis on truncated text..."

            # Check if the truncated text is non-empty before calling Comprehend
            if [ -n "$TEXT_TO_ANALYZE_TRUNCATED" ]; then
                # Pass the truncated message body to the --text parameter
                SENTIMENT_RESULT=$(aws comprehend detect-sentiment --language-code en --text "$TEXT_TO_ANALYZE_TRUNCATED" 2> /home/ec2-user/comprehend_error.log)
                SENTIMENT=$(echo "$SENTIMENT_RESULT" | jq -r '.Sentiment // "ERROR"')
                SENTIMENT_SCORE_POSITIVE=$(echo "$SENTIMENT_RESULT" | jq -r '.SentimentScore.Positive // "0"')

                # Check if SENTIMENT is ERROR which indicates a problem during the API call
                if [ "$SENTIMENT" == "ERROR" ]; then
                    echo "ERROR calling Comprehend. Check /home/ec2-user/comprehend_error.log"
                    # Decide how to handle: maybe set sentiment to UNKNOWN, skip DDB write etc.
                    # For now, let's set SENTIMENT so DDB write doesn't fail completely on missing value
                    SENTIMENT="COMPREHEND_ERROR"
                    SENTIMENT_SCORE_POSITIVE="0" # Default score on error
                else
                    echo "Sentiment: $SENTIMENT (Positive Score: $SENTIMENT_SCORE_POSITIVE)"
                fi
            else
                # Handle case where MSG_BODY was present but maybe only whitespace or became empty after potential processing
                echo "Skipping Comprehend call because text body is effectively empty after truncation."
                SENTIMENT="EMPTY_INPUT"
                SENTIMENT_SCORE_POSITIVE="0"
            fi

            # --- Write to DynamoDB (Lab 3) ---
            # This section will always have a value for SENTIMENT
            JOB_ID="job-${MSG_ID}"
            TIMESTAMP=$(date --iso-8601=seconds)
            echo "Writing results to DynamoDB table: $TABLE_NAME"
            # Ensure scorePos is treated as a string for jq argument, DDB expects {"N": "number_string"}
            SCORE_POS_STR=$(printf "%s" "$SENTIMENT_SCORE_POSITIVE")
            ITEM_JSON=$(jq -n --arg jobId "$JOB_ID" --arg ts "$TIMESTAMP" --arg status "PROCESSED_LAB3" --arg sentiment "$SENTIMENT" --arg scorePos "$SCORE_POS_STR" --arg msgBody "$MSG_BODY" '{
              "jobId": {"S": $jobId},
              "timestamp": {"S": $ts},
              "status": {"S": $status},
              "sentiment": {"S": $sentiment},
              "sentimentScorePositive": {"N": $scorePos},
              "messageBody": {"S": $msgBody}
            }')
            # Add error handling for DDB put-item
            aws dynamodb put-item --table-name "$TABLE_NAME" --item "$ITEM_JSON"
            if [ $? -eq 0 ]; then
                echo "Results written to DynamoDB."
            else
                echo "ERROR writing to DynamoDB."
                # Log the failed item?
                echo "Failed DDB Item: $ITEM_JSON" >> /home/ec2-user/dynamodb_error.log
            fi

            # Append simple confirmation to local log
            echo "Processed message ID: $MSG_ID at $TIMESTAMP, Sentiment: $SENTIMENT" >> /home/ec2-user/sqs_messages.log

            # NOTE: No SQS message delete in Lab 3

          else
            echo "No message received."
          fi
          sleep 5
        done
    ```

4. **Modify lib/compute-stack.ts:** Open `lib/compute-stack.ts`.
  * Add/Update Imports: Ensure fs, path, dynamodb, and iam are imported. Remove s3.
  ```typescript
    import * as fs from 'fs';
    import * as path from 'path';
    import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
    // Keep: cdk, Construct, ec2, sqs, and iam
  ```
  * Update Props Interface: Ensure only processingQueue and table are present.
  ```typescript
    export interface ComputeStackProps extends cdk.StackProps {
    processingQueue: sqs.Queue;
    table: dynamodb.ITable;
  } 
  ```
  * Grant Permissions: Inside the constructor, ensure the DDB Write and Comprehend permissions are granted to ec2Role.
  ```typescript
      // Grant DDB write permissions (Lab 3)
      props.table.grantWriteData(ec2Role);
      // Grant Comprehend permissions (Lab 3)
      ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({
        actions: ['comprehend:DetectSentiment'],
        resources: ['*'],
      }));
  ```
  * Replace UserData Logic: Replace the entire // --- EC2 UserData --- section down to (but not including) the // --- EC2 Instance Definition --- comment with the following code that reads the file and uses sed:
  ```typescript
        // --- EC2 UserData (Read script from file, use sed) ---
        const userData = ec2.UserData.forLinux();

        // Read script template content from external file
        // Ensure 'fs' and 'path' are imported at the top of the file
        const scriptTemplatePath = 'scripts/poll_sqs.sh.template'; // Path relative to project root
        console.log(`Reading UserData script from: ${scriptTemplatePath}`);
        let pollingScriptTemplate: string;
        try {
          pollingScriptTemplate = fs.readFileSync(scriptTemplatePath, 'utf8');
        } catch (err) {
            console.error(`Error reading script template file at ${scriptTemplatePath}:`, err);
            throw new Error(`Could not read script template file: ${scriptTemplatePath}`);
        }

        // Add commands to UserData using the template + sed approach
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
            `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template ${pollingScriptTemplate}EOF`, // Use the pollingScriptTemplate variable read from file

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
            // No textract log needed yet
            'echo "Polling script created."',

            // Run the script as ec2-user
            'echo "Starting polling script in background..."',
            'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
            'echo "UserData script finished."'
        );
  ```

## Step 6: Update App Entry Point

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
