import React from 'react'

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }
  static getDerivedStateFromError() {
    return { hasError: true }
  }
  componentDidCatch(error, info) {
    console.error('App error', error, info)
  }
  render() {
    if (this.state.hasError) {
      return (
        <div className="empty-state">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4">
            <path d="M12 2l7 4v6c0 5-3 9-7 10-4-1-7-5-7-10V6z" />
            <path d="M9.5 9.5l5 5m0-5l-5 5" />
          </svg>
          <h2>Something went wrong</h2>
          <p className="small">Reload the app. Offline mode keeps your latest data safe.</p>
        </div>
      )
    }
    return this.props.children
  }
}
