import React, { useState } from "react";
import { motion } from "framer-motion";
import "./RoomsApp.css";

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

const DAYS_OF_WEEK = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];

export default function RoomsDatePicker({ checkIn, checkOut, onChange }) {
  const [currentDate, setCurrentDate] = useState(new Date());

  // Use today's date at midnight for comparison
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const getDaysInMonth = (year, month) => new Date(year, month + 1, 0).getDate();
  const getFirstDayOfMonth = (year, month) => new Date(year, month, 1).getDay();

  const handlePrevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const handleNextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  const parseDateStr = (dateStr) => {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split("-").map(Number);
    return new Date(y, m - 1, d);
  };

  const formatDateStr = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  const checkInDate = parseDateStr(checkIn);
  const checkOutDate = parseDateStr(checkOut);

  const handleDateClick = (day) => {
    const clickedDate = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    
    // Disallow past dates
    if (clickedDate < today) return;

    const clickedStr = formatDateStr(clickedDate);

    if (!checkIn) {
      // First click: Set check-in
      onChange(clickedStr, "");
    } else if (checkIn && !checkOut) {
      // Second click
      if (clickedDate > checkInDate) {
        // Set check-out
        onChange(checkIn, clickedStr);
      } else if (clickedDate.getTime() === checkInDate.getTime()) {
        // Clicking same day does nothing or resets
        onChange(clickedStr, "");
      } else {
        // Clicked before check-in, restart selection
        onChange(clickedStr, "");
      }
    } else {
      // Both selected, restart selection
      onChange(clickedStr, "");
    }
  };

  const isSelected = (day) => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    if (checkInDate && d.getTime() === checkInDate.getTime()) return "check-in";
    if (checkOutDate && d.getTime() === checkOutDate.getTime()) return "check-out";
    return null;
  };

  const isInRange = (day) => {
    if (!checkInDate || !checkOutDate) return false;
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    return d > checkInDate && d < checkOutDate;
  };

  const isPast = (day) => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day);
    return d < today;
  };

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const daysInMonth = getDaysInMonth(year, month);
  const firstDay = getFirstDayOfMonth(year, month);

  const renderDays = () => {
    const days = [];
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="rooms-calendar-day empty"></div>);
    }
    for (let d = 1; d <= daysInMonth; d++) {
      const selectedType = isSelected(d);
      const inRange = isInRange(d);
      const past = isPast(d);
      
      let className = "rooms-calendar-day";
      if (past) className += " disabled";
      if (selectedType) className += ` selected \${selectedType}`;
      if (inRange) className += " in-range";

      days.push(
        <div key={`day-${d}`} className={className} onClick={() => !past && handleDateClick(d)}>
          <span className="day-number">{d}</span>
          {selectedType && <motion.div layoutId="selection-glow" className="selection-glow" initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} />}
        </div>
      );
    }
    return days;
  };

  return (
    <div className="rooms-datepicker-wrapper">
      <div className="rooms-calendar-header">
        <button className="rooms-calendar-nav" onClick={handlePrevMonth}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6"></polyline></svg>
        </button>
        <div className="rooms-calendar-title">
          {MONTH_NAMES[month]} <span className="rooms-calendar-year">{year}</span>
        </div>
        <button className="rooms-calendar-nav" onClick={handleNextMonth}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="9 18 15 12 9 6"></polyline></svg>
        </button>
      </div>

      <div className="rooms-calendar-grid">
        {DAYS_OF_WEEK.map(day => (
          <div key={day} className="rooms-calendar-dow">{day}</div>
        ))}
        {renderDays()}
      </div>
    </div>
  );
}
