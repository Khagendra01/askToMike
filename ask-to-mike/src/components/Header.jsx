export default function Header() {
  return (
    <header className="relative z-10 flex items-center justify-between w-full px-8 py-6">
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center size-10 rounded-full bg-primary/20 backdrop-blur-md border border-primary/30 text-primary">
          <span className="material-symbols-outlined">smart_toy</span>
        </div>
        <h1 className="text-xl font-bold tracking-tight text-white/90">Ask to Mike</h1>
      </div>
      
      <div className="flex items-center gap-4">
        <button className="flex items-center justify-center size-10 rounded-full hover:bg-white/5 transition-colors text-white/60 hover:text-white">
          <span className="material-symbols-outlined">settings</span>
        </button>
        <div 
          className="size-9 rounded-full bg-cover bg-center border border-white/10"
          style={{ backgroundImage: "url('https://lh3.googleusercontent.com/aida-public/AB6AXuA2mp-Vqz2_b2qjpE72PW7KP7_cKtW-w3tlDDsG6Hc_cDu84Yf6D2DfmJQwFeKoDQmYtlWlrE9n4fb6nK6ChYwgBrwc4PwQqit8zefubZfvaHG-iWBtQD3psK99lEKRQmzapG98Sz8_M70f2wbwB68HUy7BD86hkKVbp0JQobNUOlFDqy0laprEuJdkg6crWi4aqQVSCELo3oNamQ6HGrsQFnxVVCu1vcnj4n2zeFvGGjQOdhK8OqVv9bOJzBEPhqrM3RmNvuN48V7t')" }}
        />
      </div>
    </header>
  )
}
