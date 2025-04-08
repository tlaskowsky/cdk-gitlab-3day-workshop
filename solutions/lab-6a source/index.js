// processor-app/index.js (Added missing catch block and refined error handling)
import { SQSClient, ReceiveMessageCommand, DeleteMessageCommand } from "@aws-sdk/client-sqs";
// import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3"; // S3 client not needed when using S3Object for Textract
import { TextractClient, DetectDocumentTextCommand } from "@aws-sdk/client-textract";
import { ComprehendClient, DetectSentimentCommand } from "@aws-sdk/client-comprehend";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
// import { Readable } from "stream"; // Not needed

// --- Configuration (from Environment Variables) ---
const queueUrl = process.env.QUEUE_URL;
const tableName = process.env.TABLE_NAME;
const region = process.env.AWS_REGION;

if (!queueUrl || !tableName || !region) {
    console.error("FATAL: Missing required environment variables: QUEUE_URL, TABLE_NAME, AWS_REGION");
    process.exit(1);
}

// --- AWS SDK Clients ---
const sqsClient = new SQSClient({ region });
const textractClient = new TextractClient({ region });
const comprehendClient = new ComprehendClient({ region });
const ddbClient = new DynamoDBClient({ region });
const ddbDocClient = DynamoDBDocumentClient.from(ddbClient);

// --- Main Processing Loop ---
async function pollQueue() {
    console.log(`Polling SQS Queue: ${queueUrl}`);
    while (true) {
        let messageId = null;
        let receiptHandle = null;
        let s3Bucket = null;
        let s3Key = null;

        try { // Outer try: Handles SQS receive and initial parsing errors
            console.log("Receiving messages...");
            const receiveParams = { QueueUrl: queueUrl, MaxNumberOfMessages: 1, WaitTimeSeconds: 10, AttributeNames: ["All"], MessageAttributeNames: ["All"] };
            const receiveResult = await sqsClient.send(new ReceiveMessageCommand(receiveParams));

            if (!receiveResult.Messages || receiveResult.Messages.length === 0) {
                // console.log("No messages received."); // Reduce noise
                continue; // Go to next poll immediately
            }

            const message = receiveResult.Messages[0];
            messageId = message.MessageId; // Assign for logging/jobId
            receiptHandle = message.ReceiptHandle; // Assign for potential deletion
            const messageBody = message.Body;
            let processingSuccess = false; // Flag for deletion logic

            console.log(`Received message ID: ${messageId}`);

            // --- Parse S3 Event ---
            try { // Inner try-catch for parsing only
                console.log("Parsing S3 event...");
                const s3Event = JSON.parse(messageBody);
                if (s3Event.Records && s3Event.Records[0]?.s3) {
                    s3Bucket = s3Event.Records[0].s3.bucket.name;
                    s3Key = decodeURIComponent(s3Event.Records[0].s3.object.key.replace(/\+/g, ' ')); // Decode S3 key
                } else { throw new Error("Message body is not a valid S3 event notification."); }
                if (!s3Bucket || !s3Key) { throw new Error("Could not parse S3 bucket/key"); }
            } catch (parseError) {
                console.error(`ERROR parsing S3 event for message ID ${messageId}: ${parseError.message}. Body: ${messageBody}`);
                console.log("Deleting malformed message...");
                if (receiptHandle) { // Delete if we have a handle
                   await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
                }
                continue; // Skip processing, go to next poll
            }

            console.log(`Processing file: s3://${s3Bucket}/${s3Key}`);
            const jobId = `job-${messageId}`;
            const timestamp = new Date().toISOString();
            let extractedText = "<No text extracted>";
            let sentiment = "ERROR";
            let sentimentScorePositive = 0;

            // --- Process Document (Textract, Comprehend, DDB) ---
            try { // <<< START Inner try block for processing steps >>>
                // --- Call Textract using S3Object ---
                console.log("Calling Textract...");
                const textractParams = { Document: { S3Object: { Bucket: s3Bucket, Name: s3Key } } };
                const textractResult = await textractClient.send(new DetectDocumentTextCommand(textractParams));

                // --- Extract Text ---
                console.log("Extracting text...");
                if (textractResult.Blocks) {
                    const lines = textractResult.Blocks.filter(b => b.BlockType === "LINE").map(b => b.Text).join("\\n"); // Join with literal \n for storage if needed
                    extractedText = lines.substring(0, 4500); // Limit size
                     if (!extractedText) extractedText = "<No text found>";
                }
                 console.log(`Extracted Text (first 100 chars): ${extractedText.substring(0,100)}`);

                // --- Call Comprehend ---
                console.log("Running sentiment analysis...");
                const comprehendParams = { LanguageCode: "en", Text: extractedText };
                const sentimentResult = await comprehendClient.send(new DetectSentimentCommand(comprehendParams));
                sentiment = sentimentResult.Sentiment || "ERROR";
                sentimentScorePositive = sentimentResult.SentimentScore?.Positive || 0;
                console.log(`Sentiment: ${sentiment} (Positive Score: ${sentimentScorePositive})`);

                // --- Write to DynamoDB ---
                console.log(`Writing results to DynamoDB table: ${tableName}`);
                const ddbParams = {
                    TableName: tableName,
                    Item: { jobId, timestamp, status: "PROCESSED", s3Bucket, s3Key, sentiment, sentimentScorePositive, extractedText }
                };
                await ddbDocClient.send(new PutCommand(ddbParams));
                console.log("Results written to DynamoDB.");
                processingSuccess = true; // Mark success ONLY if all steps complete

            } catch (processingError) { // <<< ADDED Catch block for inner try >>>
                console.error(`ERROR processing document for message ID ${messageId} (s3://${s3Bucket}/${s3Key}): ${processingError.message}`, processingError);
                // Decide if you want to write a "FAILED" status to DDB here
                // Do NOT set processingSuccess = true, so message is not deleted and can be retried/DLQ'd
            } // <<< END Added Catch block

            // --- Delete SQS Message ---
            // Only delete if ALL processing steps were successful
            if (processingSuccess) {
                console.log(`Deleting message ID ${messageId} from SQS queue...`);
                if (receiptHandle) { // Ensure we have a handle
                   try { // Add try/catch around delete just in case
                     await sqsClient.send(new DeleteMessageCommand({ QueueUrl: queueUrl, ReceiptHandle: receiptHandle }));
                     console.log("Message deleted successfully.");
                   } catch (deleteError) {
                     console.error(`ERROR deleting message ID ${messageId}: ${deleteError.message}`, deleteError);
                   }
                } else {
                   console.error("Cannot delete message, receipt handle is missing.");
                }
            } else {
                console.warn(`Processing failed or incomplete for message ID ${messageId}, SQS message not deleted.`);
            }

        } catch (error) { // Outer catch: Handles SQS receive errors or unexpected errors before inner try blocks
            console.error(`FATAL error in polling loop (Message ID: ${messageId || 'N/A'}): ${error.message}`, error);
            // Optional: Implement backoff or exit strategy here
            await new Promise(resolve => setTimeout(resolve, 10000)); // Basic 10s delay on fatal error before continuing loop
        }
    } // end while true
} // end pollQueue

// Start polling
pollQueue().catch(err => {
    console.error("Polling loop exited unexpectedly:", err);
    process.exit(1); // Exit if the main loop crashes
});
