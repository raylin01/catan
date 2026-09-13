import {useEffect, useState} from 'react';
import HexBoard from './HexBoard';
import {validateNewWorldSetup} from '../../../shared/newWorld.js';

export default function NewWorldPreview({preview,gameOptions,seatCount,isHost,busy,rulesChanged,onSave}) {
  const [selection,setSelection]=useState([]);
  const identity=JSON.stringify([preview?.seed,gameOptions?.setup]);
  useEffect(()=>setSelection([]),[identity]);
  if (!preview?.hexes) return null;
  const swaps=gameOptions.setup?.hexSwaps || [];
  const nextSetup={...gameOptions.setup,hexSwaps:[...swaps,selection]};
  const validation=selection.length===2 ? validateNewWorldSetup(nextSetup,seatCount) : null;
  const valid=validation?.success===true;
  const edit=isHost && !busy && !rulesChanged;
  const select=key=>setSelection(current=>current.includes(key) ? current.filter(item=>item!==key) : current.length<2 ? [...current,key] : [key]);
  return <details className="new-world-preview"><summary>View{isHost ? ' & arrange' : ''} the islands</summary>
    <p className="room-field-help">{isHost ? rulesChanged ? 'Save your rule changes before arranging the islands.' : 'Select two tiles, then save the swap. Number discs are assigned after terrain changes.' : 'Everyone starts on this board. Harbors are placed together during setup.'}</p>
    <div className="new-world-preview-board"><HexBoard cameraKey={`preview:${preview.seed}`} hexes={preview.hexes} vertices={{}} edges={{}} players={[]} seafarers={{scenario:'new_world'}} ports={[]} animate={false} paused={false} gamePhase="waiting" previewTargets={edit ? Object.keys(preview.hexes) : []} selectedPreviewHexes={selection} onPreviewHex={select}/></div>
    {isHost && <div className="new-world-arrangement-controls">
      <p role="status" className="room-field-help">{selection.length===0 ? 'Select the first tile.' : selection.length===1 ? 'Select a second tile to swap with it.' : 'Two tiles selected.'}</p>
      {validation && !validation.success && <p className="room-field-help" role="alert">{validation.error}</p>}
      <button type="button" className="room-secondary-button" disabled={!edit || !valid} onClick={()=>onSave({...gameOptions,setup:nextSetup})}>Save swap</button>
      <button type="button" className="room-secondary-button" disabled={!edit || !swaps.length} onClick={()=>{const setup={...gameOptions.setup};delete setup.hexSwaps;onSave({...gameOptions,setup});}}>Reset arrangement</button>
    </div>}
  </details>;
}
