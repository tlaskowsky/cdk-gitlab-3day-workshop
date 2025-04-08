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
