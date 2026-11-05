import { connect, ensureSchedule, SCHEDULE_ID } from "../client.js";
console.log(`${SCHEDULE_ID}: ${await ensureSchedule(await connect())}`);
