# Poopywater Phone

An iPad-friendly private SMS dashboard. Unlike the old static mockup, this version includes a Node.js backend for searching US SMS-capable numbers, purchasing a selected number, sending SMS, receiving inbound SMS through a signed provider webhook, and viewing the inbox.

## Important requirements before it can send real texts

- This app uses Twilio Programmable Messaging. The site owner must have a Twilio account with billing enabled and use its credentials as server environment variables.
- US messaging rules may require A2P 10DLC registration for local long-code numbers and/or other verification. Complete the provider's compliance steps; this app does not bypass them.
- A hosting service is needed for the Node.js server and a public HTTPS URL for incoming-message webhooks. Use a persistent disk so the local message database survives restarts.
- Because this service can buy phone numbers and send paid SMS, have a parent/guardian help with provider accounts, billing, and deployment if you're under 18.
- Provider credentials must be stored in host environment variables, never in the HTML or GitHub repository. Never paste credentials into chat.

## Deploy on Render

1. Open https://render.com and create a Web Service from this GitHub repository.
2. Render can use the included `render.yaml` blueprint. The service needs a persistent disk; hosting and disk may cost money.
3. Set `APP_PASSWORD` to a long, unique password. Set `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_MESSAGING_SERVICE_SID` in the Render service's Environment settings.
4. Set `PUBLIC_BASE_URL` to the exact HTTPS service URL Render gives you (no trailing slash). Save and redeploy.
5. In Twilio, make sure the Messaging Service has your purchased number/sender configured and the account is allowed to send to your intended recipients. Complete any required US messaging registration.
6. Open the service URL in Safari and sign in using `APP_PASSWORD`. Choose **Find a number**, review provider fees, then explicitly confirm purchase.
7. Send a test message to a phone you control. Reply to the new number; the incoming reply should appear in the inbox. If inbound texts fail, check Twilio's webhook debugger and verify the exact public URL is set.

## Local development

- Install Node.js 20 or later.
- Copy `.env.example` to `.env`, fill the values, and run `npm install` then `npm start`.
- For local inbound webhooks, expose the server over HTTPS and set that URL as `PUBLIC_BASE_URL`.

## What this app does / doesn't do

- Provides a private password-protected dashboard.
- Searches available US local numbers with SMS capability.
- Purchases a selected number only after the user confirms in the UI.
- Sends SMS from the app and records recent inbound/outbound messages.
- Validates Twilio webhook signatures.
- Does **not** inject the number into Apple Messages. iPadOS does not offer an ordinary-app API to add a provider-issued number to Apple's Messages app. Use this app's inbox for the new number; Apple Messages forwarding is for a compatible iPhone's own line.

## Data and security notes

The message store is a local JSON file under `DATA_DIR`. Use a persistent disk and keep this a single-instance private app. Session cookies are HttpOnly and SameSite=Strict, login and sending are rate-limited, and inbound webhooks are signature-checked. This is a small personal project, not a hardened multi-user service. Do not use it for sensitive messages.
