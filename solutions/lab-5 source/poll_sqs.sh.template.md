#!/bin/bash
echo "Polling SQS Queue: %%QUEUE_URL%% (Region determined automatically by AWS CLI)"
# Assign resolved values to shell variables
QUEUE_URL="%%QUEUE_URL%%"
TABLE_NAME="%%TABLE_NAME%%"

while true; do
  echo "Receiving messages..."
  REC_MSG=$(aws sqs receive-message --queue-url "$QUEUE_URL" --attribute-names All --message-attribute-names All --wait-time-seconds 10 --max-number-of-messages 1)

  MSG_ID=$(echo "$REC_MSG" | jq -r '.Messages[0].MessageId // empty')
  RECEIPT_HANDLE=$(echo "$REC_MSG" | jq -r '.Messages[0].ReceiptHandle // empty')
  MSG_BODY=$(echo "$REC_MSG" | jq -r '.Messages[0].Body // empty')

  if [ -n "$MSG_ID" ] && [ -n "$RECEIPT_HANDLE" ] && [ -n "$MSG_BODY" ]; then
    echo "Received message ID: $MSG_ID"
    PROCESSING_SUCCESS="false"

    # --- Parse S3 Event ---
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

    # --- Download S3 Object --- (REMOVED)

    # --- Call Textract ---
    echo "Calling Textract DetectDocumentText using S3 Object..."
    # *** CHANGED: Use S3Object instead of Bytes/fileb:// ***
    # Ensure variables are quoted correctly within the JSON string passed to --document
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