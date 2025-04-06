---
layout: default
title: Lab 4 Cheatsheet
parent: Cheatsheets
grand_parent: Resources
nav_order: 4
---

# Lab 4 Troubleshooting Tips (EC2 Script & Textract)

This covers key issues encountered when adding the S3 trigger and Textract processing in Lab 4.

## 1. TypeScript Compilation Errors in `lib/compute-stack.ts`

* **Problem:** After adding the complex Lab 4 Bash logic (with `$VAR`, `$(...)`, `if`, etc.) to the `pollingScript` template literal inside `lib/compute-stack.ts`, the pipeline fails during `cdk synth` or `cdk deploy` (often in the `build_cdk` or `bootstrap_dev` stage) with numerous TypeScript errors like `Cannot find name 'MSG_ID'`, `Cannot find name 'echo'`, `Syntax error`, etc.
* **Diagnosis:** The TypeScript compiler (`ts-node` used by CDK) incorrectly tries to parse the Bash script syntax within the template literal, likely because the same literal also contains CDK token interpolation (`${props...}`). Attempts to escape shell variables (`\$`) often lead to runtime errors in the Bash script itself.
* **Solution (External Template + Sed):** Separate the Bash script definition from the CDK token injection:
    1.  **Create External Template:** Move the entire Bash script logic into a separate file (e.g., `scripts/poll_sqs.sh.template`). Use **placeholders** (e.g., `%%QUEUE_URL%%`, `%%TABLE_NAME%%`) where CDK values are needed. Use standard Bash syntax (no `\$` escaping).
    2.  **Install Types:** Ensure Node.js types are installed: `npm install --save-dev @types/node`.
    3.  **Read File in CDK:** In `lib/compute-stack.ts`, import `fs` and `path`. Use `fs.readFileSync('scripts/poll_sqs.sh.template', 'utf8')` to read the template content into a variable (e.g., `pollingScriptTemplate`). Make sure the path `'scripts/...'` is correct relative to your project root (`cdk.json`).
    4.  **Update `userData.addCommands`:**
        * Keep the `set -ex` and tool installation commands.
        * Add a command to write the `pollingScriptTemplate` variable content to a temporary file on the instance using `cat <<'EOF' > /home/ec2-user/poll_sqs.sh.template`.
        * Add `sed` command(s) to replace the `%%PLACEHOLDERS%%` in the template file with the actual CDK token values (`${props.processingQueue.queueUrl}`, `${props.table.tableName}`), writing the final script to `/home/ec2-user/poll_sqs.sh`. Use a safe delimiter like `|` in `sed` if URLs contain `/`.
        * Keep the `chmod`, `chown`, and `sudo -u ... nohup` commands to prepare and run the final script.
    5.  **Benefit:** This prevents TypeScript from seeing/parsing the complex Bash syntax during compilation.

## 2. Textract API Call Fails (`detect-document-text`)

* **Problem:** The EC2 script runs, downloads the S3 file, but fails when calling Textract. The `/home/ec2-user/textract_error.log` file contains an error like `Invalid base64: "fileb:///tmp/..."`.
    * **Diagnosis:** The script was trying to pass the literal string `"fileb:///path/to/file"` as the value for the `Bytes` key within the JSON supplied to the `--document` parameter. The `Bytes` key expects actual Base64-encoded data, and the `fileb://` shorthand doesn't work when nested inside a JSON string argument.
    * **Solution (Use `S3Object`):** Modify the `aws textract detect-document-text` command in `scripts/poll_sqs.sh.template` to use the `S3Object` key instead of `Bytes`. This tells Textract to fetch the object directly from S3.
        * Remove the `aws s3 cp ...` download step from the script.
        * Remove the `rm "$LOCAL_FILENAME"` cleanup step.
        * Change the Textract command to:
            ```bash
            TEXTRACT_RESULT=$(aws textract detect-document-text --document '{"S3Object": {"Bucket": "'"$S3_BUCKET"'", "Name": "'"$S3_KEY"'"}}' 2> /home/ec2-user/textract_error.log)
            ```
        * Ensure the EC2 instance role (`EC2InstanceRole`) has `s3:GetObject` permission on the input bucket (this was added in Lab 4, Step 2). Textract uses the instance's role credentials to access the S3 object.

## 3. General UserData Debugging

* **Check Cloud-Init Logs:** Always the first place to look for UserData script errors: `sudo cat /var/log/cloud-init-output.log`.
* **Use `set -ex`:** Ensure this is the first command in `userData.addCommands` to see exactly which command fails and why.
* **Check Permissions:** Verify the EC2 instance role has all necessary IAM permissions (SQS Receive/Delete, S3 GetObject, Textract DetectDocumentText, Comprehend DetectSentiment, DDB PutItem, CloudWatch Logs).
* **Check File Ownership:** Ensure files created by UserData (running as root) that need to be accessed or written to by the `ec2-user` script process have ownership changed (`chown ec2-user:ec2-user ...`).