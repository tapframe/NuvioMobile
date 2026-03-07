import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react';

interface TrailerContextValue {
  isTrailerPlaying: boolean;
  pauseTrailer: () => void;
  resumeTrailer: () => void;
  setTrailerPlaying: (playing: boolean) => void;
}

const TrailerContext = createContext<TrailerContextValue | undefined>(undefined);

export const TrailerProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [isTrailerPlaying, setIsTrailerPlaying] = useState(false);

  const pauseTrailer = useCallback(() => {
    setIsTrailerPlaying(false);
  }, []);

  const resumeTrailer = useCallback(() => {
    setIsTrailerPlaying(true);
  }, []);

  const setTrailerPlaying = useCallback((playing: boolean) => {
    setIsTrailerPlaying(playing);
  }, []);

  const value: TrailerContextValue = useMemo(() => ({
    isTrailerPlaying,
    pauseTrailer,
    resumeTrailer,
    setTrailerPlaying,
  }), [isTrailerPlaying, pauseTrailer, resumeTrailer, setTrailerPlaying]);

  return (
    <TrailerContext.Provider value={value}>
      {children}
    </TrailerContext.Provider>
  );
};

export const useTrailer = (): TrailerContextValue => {
  const context = useContext(TrailerContext);
  if (!context) {
    throw new Error('useTrailer must be used within a TrailerProvider');
  }
  return context;
};
