import React from 'react'

export function Skeleton({ className = '', style }) {
  return <div className={`skeleton ${className}`.trim()} style={style} aria-hidden="true" />
}

export function SkeletonText({ lines = 1 }) {
  return (
    <div className="skeleton-text" aria-hidden="true">
      {Array.from({ length: lines }).map((_, idx) => (
        <div key={idx} className="skeleton" style={{ height: 14, marginBottom: idx === lines - 1 ? 0 : 8 }} />
      ))}
    </div>
  )
}
