const mongoose = require('mongoose');
require('dotenv').config({ path: 'backend/.env' });
const Event = require('./backend/src/models/Event');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const events = await Event.find({});
  for (let e of events) {
    console.log(e.name, '=>', e.displayOrder);
  }
  process.exit(0);
}
run();
