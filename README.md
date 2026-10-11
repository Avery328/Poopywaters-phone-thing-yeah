# Get Phone Number from Poopywater — iPad Starter

This is a responsive static prototype for an iPad-friendly phone-number dashboard.

## Run it
Open `index.html` in a browser, or enable GitHub Pages to host it as a website.

## Included
- Responsive iPad-friendly dashboard
- Get-number setup dialog
- Apple Messages setup guidance
- Clear explanation of the platform limitations

## Not yet implemented
- Real phone-number provisioning
- SMS send/receive backend
- Accounts, authentication, billing, and secure storage

## Apple Messages limitation
Apple Messages on iPad normally sends/receives SMS/RCS by forwarding messages from a compatible iPhone. An app cannot simply create a separate number and inject it into Messages. A provider-issued number will generally need its own messaging interface and backend unless a specifically supported integration exists.

Provider credentials must be stored on the server, never in browser JavaScript.
