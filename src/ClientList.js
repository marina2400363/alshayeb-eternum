import React, { useState, useEffect } from "react";
import { db } from "./firebase";  // Correct import of db from firebase.js
import { collection, getDocs } from "firebase/firestore";  // Firestore functions

function ClientList() {
  const [clients, setClients] = useState([]);

  // Fetch data from Firestore when the component mounts
  useEffect(() => {
    const fetchClients = async () => {
      const querySnapshot = await getDocs(collection(db, "clients"));
      const clientsData = querySnapshot.docs.map((doc) => doc.data());
      setClients(clientsData);  // Set the fetched data into state
    };

    fetchClients();
  }, []);

  return (
    <div>
      <h2>Client List</h2>
      <ul>
        {clients.map((client, index) => (
          <li key={index}>
            {client.name} - {client.phone}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default ClientList;