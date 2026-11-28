// scripts/sync-vapi.js
// Creates or updates the assistant and tools in Vapi using a Private API Key

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const privateKey = process.argv[2] || process.env.VAPI_PRIVATE_KEY;
if (!privateKey) {
  console.error("Xatolik: Vapi Private API Key kiritilmadi!");
  console.error("Ishlatish: node scripts/sync-vapi.js <VAPI_PRIVATE_KEY>");
  process.exit(1);
}

const assistantPath = path.resolve(__dirname, '../vapi/vapi-assistant.json');
const assistantConfig = JSON.parse(fs.readFileSync(assistantPath, 'utf8'));

// Render webhook url & secret
assistantConfig.server = {
  url: "https://call-operator-1.onrender.com/webhook/vapi",
  secret: "THATMYFIRSTmoneymaker"
};
assistantConfig.serverUrl = "https://call-operator-1.onrender.com/webhook/vapi";

async function sync() {
  console.log("Vapi hisobingizga Assistant va Tools yuklanmoqda...");
  try {
    const res = await fetch("https://api.vapi.ai/assistant", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${privateKey.trim()}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(assistantConfig)
    });

    const data = await res.json();
    if (!res.ok) {
      console.error("Vapi API xatosi:", data);
      process.exit(1);
    }

    console.log("Muvaffaqiyatli yaratildi!");
    console.log("Assistant ID:", data.id);
    console.log("Assistant Name:", data.name);
    console.log("Tools soni:", data.model?.tools?.length || 0);
  } catch (err) {
    console.error("Tarmoq xatosi:", err.message);
    process.exit(1);
  }
}

sync();
