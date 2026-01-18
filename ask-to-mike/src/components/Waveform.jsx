export default function Waveform({ isActive }) {
  const bars = [
    { delay: '0.0s', height: '30%' },
    { delay: '0.2s', height: '50%' },
    { delay: '0.4s', height: '70%' },
    { delay: '0.1s', height: '40%' },
    { delay: '0.5s', height: '80%' },
    { delay: '0.3s', height: '60%' },
    { delay: '0.6s', height: '90%' },
    { delay: '0.2s', height: '50%' },
    { delay: '0.4s', height: '70%' },
    { delay: '0.1s', height: '30%' },
    { delay: '0.5s', height: '60%' },
    { delay: '0.3s', height: '80%' },
    { delay: '0.6s', height: '50%' },
    { delay: '0.2s', height: '40%' },
    { delay: '0.4s', height: '60%' },
    { delay: '0.1s', height: '30%' },
  ]

  if (!isActive) return null

  return (
    <div 
      aria-hidden="true" 
      className="flex items-center gap-1 h-5 px-3 mb-1 opacity-90 select-none pointer-events-none"
    >
      {bars.map((bar, index) => (
        <div
          key={index}
          className="wave-bar"
          style={{ 
            animationDelay: bar.delay,
            height: bar.height
          }}
        />
      ))}
    </div>
  )
}
