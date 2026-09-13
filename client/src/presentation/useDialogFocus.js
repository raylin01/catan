import {useEffect,useRef} from 'react';

export function useDialogFocus(onClose) {
  const ref=useRef(null), close=useRef(onClose);
  close.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement, panel=ref.current;
    panel?.focus();
    const key=event=>{
      if(event.key==='Escape'&&close.current){event.preventDefault();event.stopPropagation();close.current();return;}
      if(event.key!=='Tab'||!panel)return;
      const targets=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex="0"]')].filter(el=>el.getClientRects().length);
      if(!targets.length){event.preventDefault();panel.focus();return;}
      const first=targets[0],last=targets.at(-1),current=document.activeElement;
      if(!panel.contains(current)||current===panel){event.preventDefault();(event.shiftKey?last:first).focus();}
      else if(event.shiftKey&&current===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&current===last){event.preventDefault();first.focus();}
    };
    panel?.addEventListener('keydown',key);
    return()=>{panel?.removeEventListener('keydown',key);if(previous?.isConnected)previous.focus();};
  },[]);
  return ref;
}
