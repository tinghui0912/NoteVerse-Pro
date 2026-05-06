
'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

export const PageWrapper = ({ children }: { children: ReactNode }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      className="py-16"
    >
      {children}
    </motion.div>
  );
};
