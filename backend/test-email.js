require('dotenv').config();
const { sendStatusEmail, sendRoomStatusEmail } = require('./src/utils/email');

async function test() {
  console.log('Testing email config...');
  console.log('RESEND_API_KEY exists?', Boolean(process.env.RESEND_API_KEY));
  
  try {
    console.log('Testing QR email generation...');
    const qrResult = await sendStatusEmail({ email: 'test@example.com', _id: '123' }, 'Test', 'Hello\nWorld');
    console.log('QR Email Result:', qrResult);
  } catch (err) {
    console.error('QR Email Error:', err);
  }

  try {
    console.log('Testing Room email generation...');
    const roomResult = await sendRoomStatusEmail({ emailAddress: 'test@example.com', reservationId: '123' }, 'Test', 'Hello\nWorld');
    console.log('Room Email Result:', roomResult);
  } catch (err) {
    console.error('Room Email Error:', err);
  }
}

test();
