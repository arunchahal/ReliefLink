import React from 'react';
import { motion } from 'framer-motion';
import { FaBroadcastTower, FaUserClock, FaCheckCircle, FaExclamationTriangle } from 'react-icons/fa';

const Timeline = ({ timeline = [] }) => {
  const getIcon = (status) => {
    switch (status) {
      case 'pending':
        return <FaBroadcastTower className="text-red-500" />;
      case 'in-progress':
        return <FaUserClock className="text-amber-500" />;
      case 'resolved':
        return <FaCheckCircle className="text-emerald-500" />;
      default:
        return <FaExclamationTriangle className="text-blue-500" />;
    }
  };

  const getColorClass = (status) => {
    switch (status) {
      case 'pending':
        return 'bg-red-50 border-red-200 text-red-700';
      case 'in-progress':
        return 'bg-amber-50 border-amber-200 text-amber-700';
      case 'resolved':
        return 'bg-emerald-50 border-emerald-200 text-emerald-700';
      default:
        return 'bg-blue-50 border-blue-200 text-blue-700';
    }
  };

  if (!timeline || timeline.length === 0) {
    return (
      <div className="text-center py-6 text-gray-400 text-sm font-medium italic">
        No history updates recorded.
      </div>
    );
  }

  return (
    <div className="relative pl-6 border-l-2 border-dashed border-gray-200 py-2 space-y-6">
      {timeline.map((event, idx) => {
        const timestamp = new Date(event.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        const date = new Date(event.timestamp).toLocaleDateString([], { month: 'short', day: 'numeric' });

        return (
          <motion.div
            key={event.id || idx}
            initial={{ opacity: 0, x: -10 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: idx * 0.1 }}
            className="relative"
          >
            {/* Dot Indicator */}
            <div className={`absolute -left-[37px] top-1 w-6 h-6 rounded-full border-2 bg-white flex items-center justify-center shadow-sm z-10 ${getColorClass(event.status).split(' ')[1]}`}>
              {getIcon(event.status)}
            </div>

            {/* Content card */}
            <div className={`p-4 rounded-2xl border shadow-sm ${getColorClass(event.status)}`}>
              <div className="flex justify-between items-start gap-4">
                <span className="font-bold text-sm leading-snug">{event.message}</span>
                <div className="text-[10px] font-black uppercase tracking-wider opacity-60 text-right shrink-0">
                  <div>{timestamp}</div>
                  <div>{date}</div>
                </div>
              </div>
            </div>
          </motion.div>
        );
      })}
    </div>
  );
};

export default Timeline;
