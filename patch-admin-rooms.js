const fs = require('fs');

const code = `
// --- ROOMS ADMIN ---
function AdminRooms() {
  const [hotels, setHotels] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('hotels');

  // Modals
  const [hotelModalOpen, setHotelModalOpen] = useState(false);
  const [editingHotel, setEditingHotel] = useState(null);
  const [hotelForm, setHotelForm] = useState({ name: '', description: '', status: 'available', startingPrice: 0, displayOrder: 999 });

  const [roomTypeModalOpen, setRoomTypeModalOpen] = useState(false);
  const [editingRoomType, setEditingRoomType] = useState(null);
  const [roomTypeForm, setRoomTypeForm] = useState({ hotelId: '', name: '', capacity: 2, breakfastIncluded: false, pricePerNight: 0, status: 'available', displayOrder: 999 });

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [hRes, rtRes, rRes] = await Promise.all([
        apiRequest('/api/admin/rooms/hotels'),
        apiRequest('/api/admin/rooms/room-types'),
        apiRequest('/api/admin/rooms/reservations')
      ]);
      setHotels(hRes.hotels || []);
      setRoomTypes(rtRes.roomTypes || []);
      setReservations(rRes.reservations || []);
    } catch (e) {
      console.error(e);
      alert("Failed to load rooms data");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const saveHotel = async (e) => {
    e.preventDefault();
    try {
      const url = editingHotel ? \`/api/admin/rooms/hotels/\${editingHotel._id}\` : '/api/admin/rooms/hotels';
      await apiRequest(url, { method: editingHotel ? 'PUT' : 'POST', body: JSON.stringify(hotelForm) });
      setHotelModalOpen(false);
      loadData();
    } catch(err) { alert(err.message); }
  };

  const deleteHotel = async (id) => {
    if (!window.confirm("Are you sure? This deletes the hotel and all its room types.")) return;
    try {
      await apiRequest(\`/api/admin/rooms/hotels/\${id}\`, { method: 'DELETE' });
      loadData();
    } catch(err) { alert(err.message); }
  };

  const saveRoomType = async (e) => {
    e.preventDefault();
    try {
      const url = editingRoomType ? \`/api/admin/rooms/room-types/\${editingRoomType._id}\` : '/api/admin/rooms/room-types';
      await apiRequest(url, { method: editingRoomType ? 'PUT' : 'POST', body: JSON.stringify(roomTypeForm) });
      setRoomTypeModalOpen(false);
      loadData();
    } catch(err) { alert(err.message); }
  };

  const deleteRoomType = async (id) => {
    if (!window.confirm("Delete this room type?")) return;
    try {
      await apiRequest(\`/api/admin/rooms/room-types/\${id}\`, { method: 'DELETE' });
      loadData();
    } catch(err) { alert(err.message); }
  };

  return (
    <AdminLayout>
      <AdminHeader eyebrow="CONTROL ROOM" title="Rooms Administration" />
      <div className="admin-tabs" style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
        <button className={view === 'hotels' ? 'admin-tab active' : 'admin-tab'} onClick={() => setView('hotels')}>Hotels</button>
        <button className={view === 'roomTypes' ? 'admin-tab active' : 'admin-tab'} onClick={() => setView('roomTypes')}>Room Types</button>
      </div>

      <div className="admin-panel">
        {loading ? <p>Loading...</p> : (
          <>
            {view === 'hotels' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 className="admin-panel-title">Manage Hotels</h3>
                  <button className="eternum-button primary small" onClick={() => { setEditingHotel(null); setHotelForm({ name: '', description: '', status: 'available', startingPrice: 0, displayOrder: 999 }); setHotelModalOpen(true); }}>+ Add Hotel</button>
                </div>
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead><tr><th>Name</th><th>Status</th><th>Starting Price</th><th>Actions</th></tr></thead>
                    <tbody>
                      {hotels.map(h => (
                        <tr key={h._id}>
                          <td>{h.name}</td>
                          <td>{h.status}</td>
                          <td>{h.startingPrice} EGP</td>
                          <td>
                            <button className="action-button edit" onClick={() => { setEditingHotel(h); setHotelForm(h); setHotelModalOpen(true); }}>Edit</button>
                            <button className="action-button danger" onClick={() => deleteHotel(h._id)}>Delete</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {view === 'roomTypes' && (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '1rem' }}>
                  <h3 className="admin-panel-title">Manage Room Types</h3>
                  <button className="eternum-button primary small" onClick={() => { setEditingRoomType(null); setRoomTypeForm({ hotelId: hotels[0]?._id || '', name: '', capacity: 2, breakfastIncluded: false, pricePerNight: 0, status: 'available', displayOrder: 999 }); setRoomTypeModalOpen(true); }}>+ Add Room Type</button>
                </div>
                <div className="admin-table-container">
                  <table className="admin-table">
                    <thead><tr><th>Hotel</th><th>Name</th><th>Capacity</th><th>Price</th><th>Actions</th></tr></thead>
                    <tbody>
                      {roomTypes.map(rt => {
                        const h = hotels.find(ht => ht._id === rt.hotelId);
                        return (
                        <tr key={rt._id}>
                          <td>{h ? h.name : 'Unknown'}</td>
                          <td>{rt.name}</td>
                          <td>{rt.capacity}</td>
                          <td>{rt.pricePerNight} EGP</td>
                          <td>
                            <button className="action-button edit" onClick={() => { setEditingRoomType(rt); setRoomTypeForm(rt); setRoomTypeModalOpen(true); }}>Edit</button>
                            <button className="action-button danger" onClick={() => deleteRoomType(rt._id)}>Delete</button>
                          </td>
                        </tr>
                      )})}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {hotelModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 className="modal-title">{editingHotel ? "Edit Hotel" : "Create Hotel"}</h2>
            <form onSubmit={saveHotel}>
              <div className="form-group"><label>Name</label><input type="text" value={hotelForm.name} onChange={e => setHotelForm({...hotelForm, name: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label>Description</label><textarea value={hotelForm.description} onChange={e => setHotelForm({...hotelForm, description: e.target.value})} className="eternum-input" /></div>
              <div className="form-group"><label>Starting Price</label><input type="number" value={hotelForm.startingPrice} onChange={e => setHotelForm({...hotelForm, startingPrice: e.target.value})} className="eternum-input" /></div>
              <div className="form-group"><label>Status</label><select value={hotelForm.status} onChange={e => setHotelForm({...hotelForm, status: e.target.value})} className="eternum-input"><option value="available">Available</option><option value="fully_booked">Fully Booked</option><option value="hidden">Hidden</option><option value="not_available">Not Available</option></select></div>
              <div className="modal-actions"><button type="button" className="eternum-button secondary" onClick={() => setHotelModalOpen(false)}>Cancel</button><button type="submit" className="eternum-button primary">Save Hotel</button></div>
            </form>
          </div>
        </div>
      )}

      {roomTypeModalOpen && (
        <div className="modal-overlay">
          <div className="modal-content">
            <h2 className="modal-title">{editingRoomType ? "Edit Room Type" : "Create Room Type"}</h2>
            <form onSubmit={saveRoomType}>
              <div className="form-group"><label>Hotel</label><select value={roomTypeForm.hotelId} onChange={e => setRoomTypeForm({...roomTypeForm, hotelId: e.target.value})} required className="eternum-input"><option value="">Select Hotel</option>{hotels.map(h => <option key={h._id} value={h._id}>{h.name}</option>)}</select></div>
              <div className="form-group"><label>Name</label><input type="text" value={roomTypeForm.name} onChange={e => setRoomTypeForm({...roomTypeForm, name: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label>Capacity</label><input type="number" value={roomTypeForm.capacity} onChange={e => setRoomTypeForm({...roomTypeForm, capacity: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label>Price Per Night</label><input type="number" value={roomTypeForm.pricePerNight} onChange={e => setRoomTypeForm({...roomTypeForm, pricePerNight: e.target.value})} required className="eternum-input" /></div>
              <div className="form-group"><label style={{display:'flex', gap:'0.5rem', alignItems:'center'}}><input type="checkbox" checked={roomTypeForm.breakfastIncluded} onChange={e => setRoomTypeForm({...roomTypeForm, breakfastIncluded: e.target.checked})} /> Breakfast Included</label></div>
              <div className="form-group"><label>Status</label><select value={roomTypeForm.status} onChange={e => setRoomTypeForm({...roomTypeForm, status: e.target.value})} className="eternum-input"><option value="available">Available</option><option value="fully_booked">Fully Booked</option><option value="hidden">Hidden</option><option value="not_available">Not Available</option></select></div>
              <div className="modal-actions"><button type="button" className="eternum-button secondary" onClick={() => setRoomTypeModalOpen(false)}>Cancel</button><button type="submit" className="eternum-button primary">Save Room Type</button></div>
            </form>
          </div>
        </div>
      )}
    </AdminLayout>
  );
}
`;

let appjs = fs.readFileSync('src/App.js', 'utf8');
if (!appjs.includes('AdminRooms')) {
  appjs = appjs.replace('export default App;', code + '\nexport default App;');
  fs.writeFileSync('src/App.js', appjs);
  console.log("AdminRooms appended.");
}
