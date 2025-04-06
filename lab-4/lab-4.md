---
layout: default
title: Lab 4 Hands-on Instructions
nav_order: 41
has_children: true
sitemap: false
published: false
nav_exclude: true  # Many Jekyll themes use this
---

# Lab 4: Event Pipeline Complete (Textract + Real File Ingestion)**

## Goal

Configure the S3 bucket to trigger the SQS queue on object creation. Update the EC2 instance script to process these events by downloading the file from S3, extracting text using Textract, analyzing sentiment with Comprehend, storing results in DynamoDB, and deleting the processed message from SQS.

##Prerequisites

* Completion of Lab 3. Your project deploys successfully to Dev with prefixing, DDB table, Comprehend permissions, and the Custom Resource Seeder.
* Local environment configured.
* A sample PDF file containing some text available on your local machine for testing uploads.

## Step 1: Add S3 Event Notification to SQS

Modify the `CoreStack` to configure the input S3 bucket to send notifications to the SQS queue when new objects are created.

1.  **Open `lib/core-stack.ts`**.
2.  **Import necessary modules:** Add imports for `s3_notifications`.
    ```typescript
    import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
    // Ensure s3 and sqs imports also exist
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    ```
3.  **Add Event Notification:** Inside the constructor, after the `this.bucket` definition, add the following code:
    ```typescript
      // Inside CoreStack constructor, after this.bucket = new s3.Bucket(...)

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
    ```

## Step 2: Update EC2 Role Permissions

Modify the `ComputeStack` to grant the EC2 instance role the additional permissions needed for this lab.

1.  **Open `lib/compute-stack.ts`**.
2.  **Import S3 module:** Add `import * as s3 from 'aws-cdk-lib/aws-s3';` if not already present.
3.  **Update Props Interface:** Modify the `ComputeStackProps` interface to accept the input bucket.
    ```typescript
    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
      table: dynamodb.ITable;
      inputBucket: s3.IBucket; // <<< ADD THIS LINE (use IBucket interface)
    }
    ```
4.  **Grant Permissions:** Inside the constructor, find the `ec2Role` definition and add grants/policy statements for S3 Read, Textract Detect, and SQS Delete.
    ```typescript
      // Inside ComputeStack constructor, after existing grants for SQS/DDB/Comprehend

      // Grant S3 Read permissions on the input bucket passed via props
      props.inputBucket.grantRead(ec2Role); // <<< ADD THIS LINE

      // Grant SQS Delete message permission
      props.processingQueue.grantDeleteMessages(ec2Role); // <<< ADD THIS LINE

      // Grant Textract permissions
      ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({ // <<< ADD THIS BLOCK
        actions: ['textract:DetectDocumentText'], // Add AnalyzeDocument if needed later
        resources: ['*'], // Textract actions are typically not resource-specific for DetectDocumentText
      }));
    ```

## Step 3: Update App Entry Point

Modify `bin/app.ts` to pass the input bucket from `CoreStack` to `ComputeStack`.

1.  **Open `bin/<your-project-name>.ts`**.
2.  **Pass Bucket to ComputeStack:** Modify the `ComputeStack` instantiation:
    ```typescript
      // Inside bin/app.ts

      // ... (CoreStack instantiation remains the same) ...
      const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

      console.log('Instantiating ComputeStack...');
      const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
        ...deploymentProps,
        processingQueue: coreStack.queue,
        table: coreStack.table,
        inputBucket: coreStack.bucket, // <<< ADD THIS LINE
      });
      // ... (Aspects remain the same) ...
    ```

## Step 4: Update EC2 UserData Script

Modify the `pollingScriptTemplate` in `lib/compute-stack.ts` to handle the full workflow: parse S3 event, download file, call Textract, call Comprehend with extracted text, write results to DDB, delete SQS message.

1.  **Open `lib/compute-stack.ts`**.
2.  **Replace `pollingScriptTemplate`:** Replace the entire `const pollingScriptTemplate = \`...\`;` definition with the following updated script template. Read the comments carefully to understand the changes.
    ```typescript
      // Inside ComputeStack constructor

      // Define the script TEMPLATE with PLACEHOLDERS and full Lab 4 logic
      const pollingScriptTemplate = `#!/bin/bash
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
          # Extract bucket name and object key from the S3 event notification structure
          # Handle URL encoding in keys (e.g., spaces become '+')
          S3_BUCKET=$(echo "$MSG_BODY" | jq -r '.Records[0].s3.bucket.name // empty')
          S3_KEY_ENCODED=$(echo "$MSG_BODY" | jq -r '.Records[0].s3.object.key // empty')
          # Use printf for more robust URL decoding (handles %20 etc.)
          S3_KEY=$(printf '%b' "${S3_KEY_ENCODED//%/\\x}")

          if [ -z "$S3_BUCKET" ] || [ -z "$S3_KEY" ]; then
            echo "ERROR: Could not parse S3 bucket/key from SQS message body: $MSG_BODY"
            # Delete the malformed message to prevent infinite loops
            echo "Deleting malformed message..."
            aws sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$RECEIPT_HANDLE"
            sleep 5
            continue # Skip to next loop iteration
          fi

          echo "Processing file: s3://$S3_BUCKET/$S3_KEY"
          # Create a temporary file with a unique name based on Message ID
          LOCAL_FILENAME="/tmp/$(echo $MSG_ID | tr -cd '[:alnum:]').pdf"
          JOB_ID="job-${MSG_ID}" # Use Message ID for Job ID in DDB
          TIMESTAMP=$(date --iso-8601=seconds)

          # --- Download S3 Object ---
          echo "Downloading S3 object..."
          aws s3 cp "s3://${S3_BUCKET}/${S3_KEY}" "$LOCAL_FILENAME"
          if [ $? -ne 0 ]; then
            echo "ERROR: Failed to download S3 object s3://${S3_BUCKET}/${S3_KEY}"
            # Let message retry/DLQ - don't delete yet
            sleep 5
            continue
          fi

          # --- Call Textract ---
          echo "Calling Textract DetectDocumentText..."
          # Use fileb:// to upload local file bytes
          TEXTRACT_RESULT=$(aws textract detect-document-text --document "{\\"Bytes\\": \\"fileb://${LOCAL_FILENAME}\\"}" 2> /home/ec2-user/textract_error.log)
          if [ $? -ne 0 ]; then
            echo "ERROR: Textract call failed. Check textract_error.log"
            # Let message retry/DLQ - don't delete yet
            rm "$LOCAL_FILENAME" # Clean up downloaded file
            sleep 5
            continue
          fi

          # --- Extract Text from Textract Result ---
          echo "Extracting text from Textract result..."
          # Concatenate text from all LINE blocks, limit total size (e.g., 4500 bytes for Comprehend)
          EXTRACTED_TEXT=$(echo "$TEXTRACT_RESULT" | jq -r '.Blocks[] | select(.BlockType=="LINE") | .Text' | head -c 4500)
          if [ -z "$EXTRACTED_TEXT" ]; then
            echo "Warning: No text extracted by Textract."
            EXTRACTED_TEXT="<No text found>"
          fi
          # echo "Extracted Text (first 100 chars): $(echo $EXTRACTED_TEXT | head -c 100)"

          # --- Call Comprehend ---
          echo "Running sentiment analysis on extracted text..."
          # Ensure extracted text is properly quoted for the CLI command
          # Use printf %s "$EXTRACTED_TEXT" for safer handling of arbitrary text via stdin
          SENTIMENT_RESULT=$(printf '%s' "$EXTRACTED_TEXT" | aws comprehend detect-sentiment --language-code en --text file:///dev/stdin 2> /home/ec2-user/comprehend_error.log)
          SENTIMENT=$(echo "$SENTIMENT_RESULT" | jq -r '.Sentiment // "ERROR"')
          SENTIMENT_SCORE_POSITIVE=$(echo "$SENTIMENT_RESULT" | jq -r '.SentimentScore.Positive // "0"')
          echo "Sentiment: $SENTIMENT (Positive Score: $SENTIMENT_SCORE_POSITIVE)"

          # --- Write to DynamoDB ---
          echo "Writing results to DynamoDB table: $TABLE_NAME"
          # Construct item, including S3 info and extracted text (potentially truncated)
          # Using printf for text to handle potential special characters better in jq arg
          ITEM_JSON=$(jq -n \
            --arg jobId "$JOB_ID" \
            --arg ts "$TIMESTAMP" \
            --arg status "PROCESSED" \
            --arg bucket "$S3_BUCKET" \
            --arg key "$S3_KEY" \
            --arg sentiment "$SENTIMENT" \
            --arg scorePos "$SENTIMENT_SCORE_POSITIVE" \
            --arg text "$(printf '%s' "$EXTRACTED_TEXT")" \
            '{
              "jobId": {"S": $jobId}, "timestamp": {"S": $ts}, "status": {"S": $status},
              "s3Bucket": {"S": $bucket}, "s3Key": {"S": $key},
              "sentiment": {"S": $sentiment}, "sentimentScorePositive": {"N": $scorePos},
              "extractedText": {"S": $text}
            }')

          aws dynamodb put-item --table-name "$TABLE_NAME" --item "$ITEM_JSON"
          if [ $? -eq 0 ]; then
              echo "Results written to DynamoDB."
              PROCESSING_SUCCESS="true" # Mark as success only if DDB write succeeds
          else
              echo "ERROR writing to DynamoDB. Message will likely be reprocessed."
          fi

          # --- Delete SQS Message ---
          if [ "$PROCESSING_SUCCESS" == "true" ]; then
            echo "Deleting message from SQS queue..."
            aws sqs delete-message --queue-url "$QUEUE_URL" --receipt-handle "$RECEIPT_HANDLE"
            if [ $? -eq 0 ]; then
              echo "Message deleted successfully."
            else
              echo "ERROR deleting message $MSG_ID with handle $RECEIPT_HANDLE"
            fi
            # Append simple confirmation to local log (optional)
            echo "Successfully processed message ID: $MSG_ID for s3://${S3_BUCKET}/${S3_KEY} at $TIMESTAMP" >> /home/ec2-user/sqs_messages.log
          fi

          rm "$LOCAL_FILENAME" # Clean up downloaded file

        else
          echo "No message received or failed to parse message details."
          # If no message, loop continues after sleep
        fi

        # Pause between polls
        sleep 5
      done`;

      // --- Update UserData.addCommands ---
      // Ensure the addCommands block uses the heredoc + sed approach from Lab 3 final
      userData.addCommands(
          'set -ex',
          'echo "UserData Update Trigger: $(date)" > /home/ec2-user/userdata_trigger.log',
          // ... installs ...
          'echo "Creating polling script template..."',
          `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template
${pollingScriptTemplate}
EOF`, // Use the UPDATED pollingScriptTemplate
          'echo "Replacing placeholders in script..."',
          `sed -e "s|%%QUEUE_URL%%|${props.processingQueue.queueUrl}|g" \\`,
          `    -e "s|%%TABLE_NAME%%|${props.table.tableName}|g" \\`, // Pass Table Name token
          `    /home/ec2-user/poll_sqs.sh.template > /home/ec2-user/poll_sqs.sh`,
          'chmod +x /home/ec2-user/poll_sqs.sh',
          // ... chown/touch commands (ensure textract_error.log is included) ...
          'chown ec2-user:ec2-user /home/ec2-user/poll_sqs.sh',
          'touch /home/ec2-user/sqs_messages.log && chown ec2-user:ec2-user /home/ec2-user/sqs_messages.log',
          'touch /home/ec2-user/poll_sqs.out && chown ec2-user:ec2-user /home/ec2-user/poll_sqs.out',
          'touch /home/ec2-user/userdata_trigger.log && chown ec2-user:ec2-user /home/ec2-user/userdata_trigger.log',
          'touch /home/ec2-user/comprehend_error.log && chown ec2-user:ec2-user /home/ec2-user/comprehend_error.log',
          'touch /home/ec2-user/textract_error.log && chown ec2-user:ec2-user /home/ec2-user/textract_error.log', // Add textract log
          'echo "Polling script created."',
          'echo "Starting polling script in background..."',
          'sudo -u ec2-user bash -c "nohup /home/ec2-user/poll_sqs.sh > /home/ec2-user/poll_sqs.out 2>&1 &"',
          'echo "UserData script finished."'
      );
    ```

## Step 5: Deploy and Verify

1.  **Commit and Push:** Save all changes (`lib/core-stack.ts`, `lib/compute-stack.ts`, `bin/app.ts`), commit, and push.
    ```bash
    git add .
    git commit -m "Lab 4: Add Textract, S3 Event Trigger, SQS Delete"
    git push origin main
    ```
2.  **Monitor Dev Pipeline:** Watch the pipeline deploy the changes.
3.  **Verify CloudFormation:** Check `CoreStack` update (S3 Notification) and `ComputeStack` update (IAM Role, UserData).
4.  **Test:**
    * Go to the S3 console for your input bucket (e.g., `stuXX-dev-corestack-documentinputbucket...`).
    * Upload a sample **PDF file** containing some text into the bucket (ensure the suffix matches your filter, e.g., `.pdf`). If using a prefix filter (like `uploads/`), upload it there.
5.  **Verify Results:**
    * **SQS:** Check the queue in the SQS console. The message count should briefly increase and then decrease back to 0 quickly.
    * **DynamoDB:** Go to your DynamoDB table (`stuXX-dev-corestack-processingresultstable...`). Refresh the items. Look for a new item corresponding to your uploaded file (check `s3Bucket` and `s3Key`). It should have `status: PROCESSED`, `sentiment` data based on the *actual extracted text*, and an `extractedText` attribute.
    * **EC2 Logs (If needed):** Connect via Session Manager. Check `/home/ec2-user/sqs_messages.log` (should show one "Successfully processed..." entry per file). Check `/home/ec2-user/poll_sqs.out`, `/home/ec2-user/textract_error.log`, `/home/ec2-user/comprehend_error.log` for any runtime errors.

## Step 6: Clean Up Resources

* Run `cdk destroy` for the Dev environment as described previously.

---

## Congratulations!

You now have a complete, event-driven document processing pipeline! Files uploaded to S3 automatically trigger processing via SQS, Textract extracts the text, Comprehend analyzes it, and the results are stored in DynamoDB. Processed messages are also correctly deleted from the queue.