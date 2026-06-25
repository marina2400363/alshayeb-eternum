
const mongoose = require('mongoose');
const Attendee = require('./backend/src/models/Attendee');
const Event = require('./backend/src/models/Event');
require('dotenv').config({ path: './backend/.env' });

async function fix() {
  await mongoose.connect(process.env.MONGODB_URI);
  const event = await Event.findOne({ name: /The Arrival/i });
  if (!event) { console.log('Event not found'); process.exit(0); }
  
  const res = await Attendee.updateMany(
    { event: event._id, attendeeType: 'incomer', fullName: { $regex: /The Arrival/i } },
    { $set: { fullName: 'Unknown Name' } }
  );
  console.log('Fixed:', res.modifiedCount);
  process.exit(0);
}
fix();

