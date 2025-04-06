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
 Configure the S3 bucket to trigger the SQS queue on object creation. Update the EC2 instance script to process these events by parsing the S3 event, calling Textract using the S3 object reference, analyzing extracted text with Comprehend, storing results in DynamoDB, and deleting the processed message from SQS.

## Prerequisites

* Completion of Lab 3. Your project deploys successfully to Dev with prefixing, DDB table, Comprehend permissions, and the Custom Resource Seeder. The code should match the final state of Lab 3.
* Local environment configured (Node, CDK, Git, AWS Creds for Dev).
* A sample PDF file containing some text available on your local machine for testing uploads.
* The `scripts` directory exists in your project root, containing `poll_sqs.sh.template` (from Lab 3's final state).
* The `lambda` directory exists in your project root, containing `seed-ddb.ts` (from Lab 3).

## Step 1: Add S3 Event Notification to SQS

Modify the `CoreStack` to configure the input S3 bucket to send notifications to the SQS queue when new PDF objects are created.

1.  **Open `lib/core-stack.ts`**.
2.  **Import necessary modules:** Ensure `s3n` is imported.
    ```typescript
    import * as s3n from 'aws-cdk-lib/aws-s3-notifications';
    // Ensure s3 and sqs imports also exist
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as sqs from 'aws-cdk-lib/aws-sqs';
    ```
3.  **Add Event Notification:** Inside the `constructor`, after the `this.bucket` definition, **ensure** the following code exists (it might already be there if you started adding Lab 4 previously):
    ```typescript
      // Inside CoreStack constructor, after this.bucket = new s3.Bucket(...)

      // --- S3 Event Notification to SQS ---
      this.bucket.addEventNotification(
        s3.EventType.OBJECT_CREATED,
        new s3n.SqsDestination(this.queue),
        { suffix: '.pdf' } // Filter for PDF files
      );
      // Note: The SqsDestination construct automatically adds the necessary
      // permissions to the queue policy allowing S3 to send messages.
    ```

## Step 2: Update EC2 Role Permissions

Modify the `ComputeStack` to grant the EC2 instance role the additional permissions needed for Textract and S3 access.

1.  **Open `lib/compute-stack.ts`**.
2.  **Import S3 module:** Ensure `s3` and `iam` imports are present.
    ```typescript
    import * as s3 from 'aws-cdk-lib/aws-s3';
    import * as iam from 'aws-cdk-lib/aws-iam';
    ```
3.  **Update Props Interface:** Ensure the `ComputeStackProps` interface includes `inputBucket`.
    ```typescript
    export interface ComputeStackProps extends cdk.StackProps {
      processingQueue: sqs.Queue;
      table: dynamodb.ITable;
      inputBucket: s3.IBucket; // <<< Ensure this line is present
    }
    ```
4.  **Grant Permissions:** Inside the `constructor`, find the `ec2Role` definition. Ensure the grants/policy statements for S3 Read and Textract Detect are present (add them if missing).
    ```typescript
      // Inside ComputeStack constructor, after existing grants for SQS/DDB/Comprehend

      // Grant S3 Read permissions on the input bucket passed via props
      props.inputBucket.grantRead(ec2Role); // <<< Ensure this line is present

      // Note: The necessary sqs:DeleteMessage permission is already granted by
      // props.processingQueue.grantConsumeMessages(ec2Role).

      // Grant Textract permissions
      ec2Role.addToPrincipalPolicy(new iam.PolicyStatement({ // <<< Ensure this block is present
        actions: ['textract:DetectDocumentText'],
        resources: ['*'],
      }));
    ```

## Step 3: Update App Entry Point

Ensure `bin/app.ts` passes the input bucket from `CoreStack` to `ComputeStack`.

1.  **Open `bin/<your-project-name>.ts`**.
2.  **Verify Bucket Prop:** Check the `ComputeStack` instantiation. Ensure it includes `inputBucket: coreStack.bucket`.
    ```typescript
      // Inside bin/app.ts

      // ... (CoreStack instantiation) ...
      const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);

      // ...
      const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
        ...deploymentProps,
        processingQueue: coreStack.queue,
        table: coreStack.table,
        inputBucket: coreStack.bucket, // <<< Ensure this line is present
      });
      // ... (Aspects) ...
    ```

## Step 4: Update EC2 UserData Script Template

Modify the **content** of the `scripts/poll_sqs.sh.template` file to handle the full Lab 4 workflow.

1.  **Open `scripts/poll_sqs.sh.template`**.
2.  **Replace Content:** Replace the *entire content* of this file with the following Bash script:
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

        # --- Download S3 Object --- (REMOVED - Using S3Object for Textract)

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
3.  **Verify `lib/compute-stack.ts`:** Ensure your `lib/compute-stack.ts` still uses the `fs.readFileSync` and `sed` approach in the `userData.addCommands` block to process this template file correctly. It should match the final version from Lab 3 (e.g., `compute_stack_v9_read_file`). Ensure the `touch`/`chown` command for `textract_error.log` is present in `addCommands`.

## Step 5: Deploy and Verify

1.  **Commit and Push:** Save all changes (`lib/core-stack.ts`, `lib/compute-stack.ts`, `bin/app.ts`, `scripts/poll_sqs.sh.template`), commit, and push.
    ```bash
    git add .
    git commit -m "Lab 4: Add Textract, S3 Event Trigger, SQS Delete"
    git push origin main
    ```
2.  **Monitor Dev Pipeline:** Watch the pipeline deploy the changes.
3.  **Verify CloudFormation:** Check `CoreStack` update (S3 Notification) and `ComputeStack` update (IAM Role, UserData).
4.  **Test:**
    * Go to the S3 console for your input bucket (e.g., `stuXX-dev-corestack-documentinputbucket...`).
    * Upload a sample **PDF file** containing some text into the bucket (ensure the suffix matches your filter, e.g., `.pdf`).
5.  **Verify Results:**
    * **SQS:** Check the queue in the SQS console. The message count should briefly increase and then decrease back to 0 quickly.
    * **DynamoDB:** Go to your DynamoDB table (`stuXX-dev-corestack-processingresultstable...`). Refresh the items. Look for a new item corresponding to your uploaded file (check `s3Bucket` and `s3Key`). It should have `status: PROCESSED`, `sentiment` data based on the *actual extracted text*, and an `extractedText` attribute.
    * **EC2 Logs (If needed):** Connect via Session Manager. Check `/home/ec2-user/sqs_messages.log` (should show one "Successfully processed..." entry per file). Check `/home/ec2-user/poll_sqs.out`, `/home/ec2-user/textract_error.log`, `/home/ec2-user/comprehend_error.log` for any runtime errors.

## Step 6: Clean Up Resources

* Run `cdk destroy` for the Dev environment as described previously.

---

## Congratulations!

You now have a complete, event-driven document processing pipeline! Files uploaded to S3 automatically trigger processing via SQS, Textract extracts the text, Comprehend analyzes it, and the results are stored in DynamoDB. Processed messages are also correctly deleted from the queue.