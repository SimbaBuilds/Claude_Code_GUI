#!/usr/bin/env python3
"""
Fetch email from Gmail using IMAP and save to file.
Retrieves the FULL email body (not just snippet) from info@docuspa.com
with subject "Docuspa changes" dated March 9, 2026.
"""

import imaplib
import email
from email.header import decode_header
from datetime import datetime
import sys

# Gmail credentials (work account - cameron@hightower-ai.com alias)
EMAIL = "cameron.hightower@simbabuilds.com"
PASSWORD = "knfc cgob uxls apao"
IMAP_SERVER = "imap.gmail.com"
IMAP_PORT = 993

def decode_mime_words(s):
    """Decode MIME encoded words in email headers."""
    decoded_parts = []
    for part, encoding in decode_header(s):
        if isinstance(part, bytes):
            decoded_parts.append(part.decode(encoding or 'utf-8', errors='ignore'))
        else:
            decoded_parts.append(part)
    return ''.join(decoded_parts)

def get_email_body(msg):
    """Extract the full email body from a message."""
    body = ""

    if msg.is_multipart():
        # Iterate through email parts
        for part in msg.walk():
            content_type = part.get_content_type()
            content_disposition = str(part.get("Content-Disposition"))

            # Skip attachments
            if "attachment" in content_disposition:
                continue

            # Get the email body
            if content_type == "text/plain":
                try:
                    body_part = part.get_payload(decode=True)
                    if body_part:
                        body += body_part.decode(errors='ignore')
                except:
                    pass
            elif content_type == "text/html" and not body:
                # Use HTML if no plain text found
                try:
                    body_part = part.get_payload(decode=True)
                    if body_part:
                        body += body_part.decode(errors='ignore')
                except:
                    pass
    else:
        # Not multipart - get the payload
        try:
            body = msg.get_payload(decode=True).decode(errors='ignore')
        except:
            body = msg.get_payload()

    return body

def main():
    print(f"Connecting to {IMAP_SERVER}...")

    try:
        # Connect to Gmail IMAP server
        mail = imaplib.IMAP4_SSL(IMAP_SERVER, IMAP_PORT)
        mail.login(EMAIL, PASSWORD)
        print("✓ Logged in successfully")

        # Select inbox
        mail.select('INBOX')
        print("✓ Selected INBOX")

        # Search for emails from info@docuspa.com with subject "Docuspa changes"
        # Search on March 9, 2026
        search_criteria = '(FROM "info@docuspa.com" SUBJECT "Docuspa changes" SINCE "09-Mar-2026")'
        print(f"Searching with criteria: {search_criteria}")

        status, messages = mail.search(None, search_criteria)

        if status != 'OK':
            print("Error searching emails")
            sys.exit(1)

        email_ids = messages[0].split()
        print(f"✓ Found {len(email_ids)} matching email(s)")

        if len(email_ids) == 0:
            print("\nNo emails found matching the criteria.")
            print("Trying broader search (last 7 days)...")

            # Try a broader search
            search_criteria = '(FROM "info@docuspa.com" SUBJECT "Docuspa changes")'
            status, messages = mail.search(None, search_criteria)
            email_ids = messages[0].split()
            print(f"✓ Found {len(email_ids)} email(s) with broader search")

            if len(email_ids) == 0:
                print("Still no emails found. Exiting.")
                mail.close()
                mail.logout()
                sys.exit(1)

        # Get the most recent email (last in the list)
        latest_email_id = email_ids[-1]

        # Fetch the email
        print(f"\nFetching email ID: {latest_email_id.decode()}")
        status, msg_data = mail.fetch(latest_email_id, '(RFC822)')

        if status != 'OK':
            print("Error fetching email")
            sys.exit(1)

        # Parse the email
        raw_email = msg_data[0][1]
        msg = email.message_from_bytes(raw_email)

        # Extract email details
        subject = decode_mime_words(msg['Subject'] or '')
        from_addr = decode_mime_words(msg['From'] or '')
        to_addr = decode_mime_words(msg['To'] or '')
        date = msg['Date'] or ''

        print(f"\n{'='*60}")
        print(f"From: {from_addr}")
        print(f"To: {to_addr}")
        print(f"Date: {date}")
        print(f"Subject: {subject}")
        print(f"{'='*60}\n")

        # Get the full email body
        body = get_email_body(msg)

        # Save to file
        output_file = "docuspa_changes_email.txt"
        with open(output_file, 'w', encoding='utf-8') as f:
            f.write(f"From: {from_addr}\n")
            f.write(f"To: {to_addr}\n")
            f.write(f"Date: {date}\n")
            f.write(f"Subject: {subject}\n")
            f.write(f"\n{'='*60}\n\n")
            f.write(body)

        print(f"✓ Email saved to {output_file}")
        print(f"\nBody preview (first 500 chars):")
        print(body[:500])
        print("...")

        # Close connection
        mail.close()
        mail.logout()
        print("\n✓ Done!")

    except imaplib.IMAP4.error as e:
        print(f"IMAP error: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)

if __name__ == "__main__":
    main()
