import React from 'react';

interface DuartyLogoProps {
  size?: 'sm' | 'md' | 'lg' | 'xl';
  showText?: boolean;
  className?: string;
}

export const DuartyLogo: React.FC<DuartyLogoProps> = ({
  size = 'md',
  showText = true,
  className = '',
}) => {
  const sizeMap = {
    sm: { icon: 34, text: 'text-base', sub: 'text-[9px]' },
    md: { icon: 44, text: 'text-lg', sub: 'text-[10px]' },
    lg: { icon: 56, text: 'text-2xl', sub: 'text-xs' },
    xl: { icon: 84, text: 'text-3xl', sub: 'text-sm' },
  };

  const { icon: px } = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 select-none ${className}`}>
      {/* Circular Emblem with Vivid Neon Gradient Ring */}
      <div
        className="relative flex items-center justify-center rounded-full p-[2.5px] shadow-lg shadow-rose-500/10 transition-transform hover:scale-105"
        style={{
          width: px,
          height: px,
          background:
            'linear-gradient(135deg, #d946ef 0%, #ec4899 25%, #f43f5e 50%, #f97316 75%, #eab308 100%)',
        }}
      >
        <div className="w-full h-full bg-[#0a0b10] rounded-full flex items-center justify-center p-1.5 overflow-hidden">
          <svg
            viewBox="0 0 100 100"
            className="w-full h-full text-white"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {/* Outer stylized D & A geometry */}
            {/* D curve and A slant */}
            <path
              d="M26 22H52C67 22 76 31 76 45C76 59 67 68 52 68H38V78H26V22ZM38 33V57H51C60 57 64 52 64 45C64 38 60 33 51 33H38Z"
              fill="white"
            />
            {/* Crossbar & A triangle */}
            <path
              d="M34 76L50 32L66 76H54L50 63L46 76H34Z"
              fill="white"
            />
            {/* Signature red triangle accent inside A */}
            <path
              d="M50 48L44 60H56L50 48Z"
              fill="#ef4444"
            />
          </svg>
        </div>
      </div>

      {showText && (
        <div className="flex flex-col">
          <div className="flex items-center gap-1.5">
            <span className="font-extrabold tracking-[0.22em] text-white uppercase text-base sm:text-lg font-['Plus_Jakarta_Sans',sans-serif]">
              DUARTY
            </span>
            <span className="text-[10px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-gradient-to-r from-rose-500/20 to-amber-500/20 text-rose-300 border border-rose-500/30">
              VOICE
            </span>
          </div>
          <span className="text-[10px] tracking-wide text-slate-400 font-medium">
            Gestão Financeira Instantânea
          </span>
        </div>
      )}
    </div>
  );
};
