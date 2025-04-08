---
layout: default
title: Lab 4 Hands-on Instructions
nav_order: 41
has_children: true
---

# Lab 4: Event Pipeline Complete (Textract + Real File Ingestion)

## Goal

 Configure the S3 bucket to trigger the SQS queue on object creation. Refactor the EC2 instance script into an external template file and update the UserData logic to use `sed` for substitution (solving previous compilation issues). Implement the full S3 -> SQS -> EC2 -> Textract -> Comprehend -> DynamoDB workflow, including deleting processed messages from SQS.

## Prerequisites

* Completion of Lab 3. Your project deploys successfully to Dev with prefixing, DDB table, Comprehend permissions, and the Custom Resource Seeder. The code should match the final state of Lab 3.
* Local environment configured (Node, CDK, Git, AWS Creds for Dev).
* A sample PDF file containing some text available on your local machine for testing uploads.
* `@types/node` installed (`npm install --save-dev @types/node`).
* `esbuild` installed (`npm install -D esbuild`).

---

## Step 1: Add S3 Event Notification to SQS

Modify `lib/core-stack.ts` to configure the S3 bucket -> SQS trigger.

1.  **Open `lib/core-stack.ts`**.
2.  **Import necessary modules:** Add imports for `s3_notifications`.
    ```typescript
    import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
    // Ensure s3 and sqs imports also exist
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    ```
3.  **Add Event Notification:** Inside the `constructor`, after the `this.bucket` definition, add the following code block:
    ```typescript
      // Inside CoreStack constructor, after this.bucket = new s3.Bucket(...)
      // And the SQS queue definition

      // --- S3 Event Notification to SQS ---
      this.bucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.SqsDestination(this.queue),
        { suffix: '.pdf' } // Filter for PDF files
      );
    ```

---

## Step 2: Update EC2 Role Permissions

Modify `lib/compute-stack.ts` to add S3 read and Textract permissions to the EC2 instance role.

1.  **Open `lib/compute-stack.ts`**.
2.  **Add S3 Import:** Ensure the S3 import exists:
    ```typescript
    import * as s3 from 'aws-cdk-lib/aws-s3';
    // Ensure iam import also exists
    import * as iam from 'aws-cdk-lib/aws-iam';
    ```
3.  **Update Props Interface:** Add the `inputBucket` property:
    ```typescript
    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
      table: dynamodb.ITable;
      inputBucket: s3.IBucket; // <<< ADD THIS LINE
    }
    ```
4.  **Grant Permissions:** Inside the `constructor`, find the `ec2Role` definition. Add the following permission grants *after* the existing grants (for SQS, DDB, Comprehend):
    ```typescript
      // Inside ComputeStack constructor, after existing grants...

      // Grant S3 Read permissions on the input bucket passed via props
      props.inputBucket.grantRead(ec2Role); // <<< ADD THIS LINE

      // Grant Textract permissions
      ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({ // <<< ADD THIS BLOCK
        actions: ['textract:DetectDocumentText'],
        resources: ['*'],
      }));
    ```

---

## Step 3: Update App Entry Point

Modify `bin/app.ts` to pass the `inputBucket` from `CoreStack` to `ComputeStack`.

1.  **Open `bin/<your-project-name>.ts`**.
2.  **Pass Bucket Prop:** Find the `ComputeStack` instantiation and add the `inputBucket` property:
    ```typescript
      // Inside bin/app.ts
      // ... (CoreStack instantiation remains the same) ...
      const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

      // ...
      const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
        ...deploymentProps,
        processingQueue: coreStack.queue,
        table: coreStack.table,
        inputBucket: coreStack.bucket, // <<< ADD THIS LINE
      });
      // ... (Aspects remain the same) ...
    ```

---

## Step 4: Refactor EC2 UserData Script to External File

To resolve the TypeScript compilation errors caused by embedding complex Bash scripts in template literals, we will move the script to an external file and update `compute-stack.ts` to read it.

1.  **Create `scripts` Directory:** In the **root** of your project (alongside `bin` and `lib`), create a new directory named `scripts`.
2.  **Create Template File:** Inside the new `scripts` directory, create a file named `poll_sqs.sh.template`.
3.  **Add Bash Script Content:** Paste the following Bash script into `scripts/poll_sqs.sh.template`. This script uses `%%PLACEHOLDERS%%` which will be replaced by CDK/sed later.
    ```bash
    #!/bin/bash
    echo "Polling SQS Queue: %%QUEUE_URL%% (Region determined automatically by AWS CLI)"
    # Assign resolved values to shell variables
    QUEUE_URL="%%QUEUE_URL%%"
    TABLE_NAME="%%TABLE_NAME%%"

    while true; do
      echo "Receiving messages..."
      # Receive message, request MessageId and ReceiptHandle attributes
      REC_MSG=$(aws sqs receive-message --queue-url "$QUEUE_URL" --attribute-names All --message-attribute-names All --wait-time-seconds 10 --max-number-of-messages 1)

      # Extract key information using jq (handle potential errors/no message)
      MSG_ID=$(echo "$REC_MSG" | jq -r '.Messages[0].MessageId // empty')
      RECEIPT_HANDLE=$(echo "$REC_MSG" | jq -r '.Messages[0].ReceiptHandle // empty')
      MSG_BODY=$(echo "$REC_MSG" | jq -r '.Messages[0].Body // empty') # Body now contains S3 event

      # Check if a message was successfully received and parsed
      if [ -n "$MSG_ID" ] && [ -n "$RECEIPT_HANDLE" ] && [ -n "$MSG_BODY" ]; then
        echo "Received message ID: $MSG_ID"
        PROCESSING_SUCCESS="false" # Flag to track if processing succeeds for deletion

        # --- Parse S3 Event from Message Body ---
        echo "Parsing S3 event..."
        S3_BUCKET=$(echo "$MSG_BODY" | jq -r '.Records[0].s3.bucket.name // empty')
        S3_KEY_ENCODED=$(echo "$MSG_BODY" | jq -r '.Records[0].s3.object.key // empty')
        S3_KEY=$(printf '%b' "${S3_KEY_ENCODED//%/\\x}") # URL decode

        if [ -z "$S3_BUCKET" ] || [ -z "$S3_KEY" ]; then
          echo "ERROR: Could not parse S3 bucket/key from SQS message body: $MSG_BODY"
          echo "Deleting malformed message..."
          aws sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$RECEIPT_HANDLE"; sleep 5; continue
        fi

        echo "Processing file: s3://$S3_BUCKET/$S3_KEY"
        JOB_ID="job-${MSG_ID}"
        TIMESTAMP=$(date --iso-8601=seconds)

        # --- Call Textract ---
        echo "Calling Textract DetectDocumentText using S3 Object..."
        # Use S3Object instead of Bytes/fileb://
        TEXTRACT_RESULT=$(aws textract detect-document-text --document '{"S3Object": {"Bucket": "'"$S3_BUCKET"'", "Name": "'"$S3_KEY"'"}}' 2> /home/ec2-user/textract_error.log)
        if [ $? -ne 0 ]; then
          echo "ERROR: Textract call failed. Check textract_error.log"; sleep 5; continue # No local file to remove
        fi

        # --- Extract Text ---
        echo "Extracting text from Textract result..."
        EXTRACTED_TEXT=$(echo "$TEXTRACT_RESULT" | jq -r '.Blocks[] | select(.BlockType=="LINE") | .Text' | head -c 4500)
        if [ -z "$EXTRACTED_TEXT" ]; then
          echo "Warning: No text extracted by Textract."; EXTRACTED_TEXT="<No text found>"
        fi

        # --- Call Comprehend ---
        echo "Running sentiment analysis on extracted text..."
        SENTIMENT_RESULT=$(printf '%s' "$EXTRACTED_TEXT" | aws comprehend detect-sentiment --language-code en --text file:///dev/stdin 2> /home/ec2-user/comprehend_error.log)
        SENTIMENT=$(echo "$SENTIMENT_RESULT" | jq -r '.Sentiment // "ERROR"')
        SENTIMENT_SCORE_POSITIVE=$(echo "$SENTIMENT_RESULT" | jq -r '.SentimentScore.Positive // "0"')
        echo "Sentiment: $SENTIMENT (Positive Score: $SENTIMENT_SCORE_POSITIVE)"

        # --- Write to DynamoDB ---
        echo "Writing results to DynamoDB table: $TABLE_NAME"
        ITEM_JSON=$(jq -n \
          --arg jobId "$JOB_ID" --arg ts "$TIMESTAMP" --arg status "PROCESSED" \
          --arg bucket "$S3_BUCKET" --arg key "$S3_KEY" \
          --arg sentiment "$SENTIMENT" --arg scorePos "$SENTIMENT_SCORE_POSITIVE" \
          --arg text "$(printf '%s' "$EXTRACTED_TEXT")" \
          '{
            "jobId": {"S": $jobId}, "timestamp": {"S": $ts}, "status": {"S": $status},
            "s3Bucket": {"S": $bucket}, "s3Key": {"S": $key},
            "sentiment": {"S": $sentiment}, "sentimentScorePositive": {"N": $scorePos},
            "extractedText": {"S": $text}
          }')

        aws dynamodb put-item --table-name "$TABLE_NAME" --item "$ITEM_JSON"
        if [ $? -eq 0 ]; then
            echo "Results written to DynamoDB."; PROCESSING_SUCCESS="true"
        else
            echo "ERROR writing to DynamoDB."
        fi

        # --- Delete SQS Message ---
        if [ "$PROCESSING_SUCCESS" == "true" ]; then
          echo "Deleting message from SQS queue...";
          aws sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$RECEIPT_HANDLE"
          if [ $? -eq 0 ]; then echo "Message deleted successfully."; else echo "ERROR deleting message $MSG_ID"; fi
          echo "Successfully processed message ID: $MSG_ID for s3://${S3_BUCKET}/${S3_KEY} at $TIMESTAMP" >> /home/ec2-user/sqs_messages.log
        fi

        # rm "$LOCAL_FILENAME" # Clean up downloaded file (REMOVED)

      else
        echo "No message received or failed to parse message details."
      fi
      sleep 5
    done
    ```
4.  **Update `lib/compute-stack.ts`:** Open this file.
    * **Add Imports:** Add `fs` and `path` imports at the top:
      ```typescript
      import * as fs from 'fs';
      import * as path from 'path';
      ```
    * **Replace UserData Logic:** Find the `// --- EC2 UserData ---` comment inside the `constructor`. **Replace** the entire block from that comment down to (but not including) the `// --- EC2 Instance Definition ---` comment with the following code:
      ```typescript
        // --- EC2 UserData (Read script from file, use sed) ---
        const userData = ec2.UserData.forLinux();

        // *** Read script template content from external file ***
        const scriptTemplatePath = 'scripts/poll_sqs.sh.template'; // Use path relative to project root
        console.log(`Reading UserData script from: ${scriptTemplatePath}`); // Add log
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
            'curl "[https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip](https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip)" -o "awscliv2.zip"',
            'unzip awscliv2.zip',
            'sudo ./aws/install',
            'rm -rf aws awscliv2.zip',
            'echo "AWS CLI installed successfully."',

            // Write the script TEMPLATE using a heredoc
            'echo "Creating polling script template..."',
            // Write the content read from the file into the heredoc
            `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template ${pollingScriptTemplate} EOF`, // Use the pollingScriptTemplate variable read from file

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
            'touch /home/ec2-user/textract_error.log && chown ec2-user:ec2-user /home/ec2-user/textract_error.log', // Ensure textract log file is handled
            'echo "Polling script created."',

            // Run the script as ec2-user
            'echo "Starting polling script in background..."',
            'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
            'echo "UserData script finished."'
        );
      ```
      > **Note:** Ensure the `EC2 Instance Definition` block *after* this uses `userData: userData,` correctly.

---

## Step 5: Deploy and Verify

1.  **Commit and Push:** Save all changes (`lib/core-stack.ts`, `lib/compute-stack.ts`, `bin/app.ts`, **`scripts/poll_sqs.sh.template`**), commit, and push. **Make sure to `git add scripts/poll_sqs.sh.template`!**
    ```bash
    git add .
    git commit -m "Lab 4: Refactor UserData script to external file"
    git push origin main
    ```
2.  **Monitor Dev Pipeline:** Watch the pipeline deploy the changes.
3.  **Verify CloudFormation:** Check `CoreStack` and `ComputeStack` updates.
4.  **Test:** Upload a sample **PDF file** to the S3 input bucket.
5.  **Verify Results:** Check SQS (message processed/deleted), DynamoDB (new item with extracted text/sentiment), and EC2 logs if needed.

---

## Step 6: Clean Up Resources

* Run `cdk destroy` for the Dev environment as described previously.

---

## Congratulations!

You now have a complete, event-driven document processing pipeline, and you've refactored the EC2 script generation for better stability!