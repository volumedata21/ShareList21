import { processFiles } from './scanner';
import cron from 'node-cron';

// Env Variables with Type Safety
const SERVER_URL = process.env.SERVER_URL || '';
const USERNAME = process.env.CLIENT_USER || '';
const PIN = process.env.APP_PIN || '';
const MEDIA_PATH = '/media';
const CRON_SCHEDULE = process.env.CRON_SCHEDULE || '0 3 * * *';

if (!SERVER_URL || !USERNAME) {
  console.error("ERROR: Missing SERVER_URL or CLIENT_USER env variables.");
  process.exit(1);
}

async function runClientScan() {
  console.log(`--- Starting Client Scan for ${USERNAME} ---`);
  try {
    const files = await processFiles(MEDIA_PATH, USERNAME);
    
    console.log(`Uploading to ${SERVER_URL}/api/sync...`);
    
    const response = await fetch(`${SERVER_URL}/api/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-app-pin': PIN
      },
      body: JSON.stringify({ owner: USERNAME, files })
    });

    if (!response.ok) {
      throw new Error(`Server responded with ${response.status} ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`[Success] Server accepted ${result.count} files.`);
    
  } catch (err: any) {
    console.error(`[Error] Scan failed: ${err.message}`);
  }
  console.log(`--- Scan Complete. Next run: ${CRON_SCHEDULE} ---`);
}

// Start
runClientScan();
cron.schedule(CRON_SCHEDULE, runClientScan);
console.log(`Client Agent Started. Schedule: ${CRON_SCHEDULE}`);