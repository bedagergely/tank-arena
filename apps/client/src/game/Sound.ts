export function playBeep(frequency = 140, duration = 0.05) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContextClass();
    
    const oscillator = ctx.createOscillator();
    oscillator.type = 'sine'; 
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);
    
    oscillator.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + duration);
}