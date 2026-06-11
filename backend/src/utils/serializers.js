function serializeAttendee(attendee) {
  if (!attendee) return null;

  return {
    id: attendee._id,
    fullName: attendee.fullName,
    phone: attendee.phone,
    phoneNumber: attendee.phone,
    email: attendee.email || null,
    university: attendee.university || null,
    schoolOrOriginProm: attendee.university || null,
    age: attendee.age || null,
    instagram: attendee.instagram || null,
    instagramUsername: attendee.instagram || null,
    notes: attendee.notes || null,
    event: attendee.event,
    eventName: attendee.eventName || null,
    attendeeType: attendee.attendeeType,
    accessType: attendee.accessType,
    status: attendee.status,
    paymentStatus: attendee.paymentStatus,
    paymentProof: attendee.paymentProof || null,
    qrId: attendee.qrId || null,
    qrToken: attendee.qrToken || null,
    qrIssuedAt: attendee.qrIssuedAt || null,
    scannedAt: attendee.scannedAt || null,
    scanCount: attendee.scanCount || 0,
    rejectionReason: attendee.rejectionReason || null,
    createdAt: attendee.createdAt,
    updatedAt: attendee.updatedAt
  };
}

module.exports = {
  serializeAttendee
};
