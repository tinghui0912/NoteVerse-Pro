
'use client';

import React, { useRef } from 'react';
import { motion, useInView } from 'framer-motion';

export function AnimatedSection({ children, className, id }: { children: React.ReactNode, className?: string, id?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, amount: 0.2 });

  const variants = {
    hidden: { opacity: 0, y: 50 },
    visible: { opacity: 1, y: 0 },
  };

  return (
    <motion.section
      ref={ref}
      id={id}
      className={className}
      initial="hidden"
      animate={isInView ? 'visible' : 'hidden'}
      variants={variants}
      transition={{ duration: 0.8, ease: 'easeOut' }}
    >
      {children}
    </motion.section>
  );
}
