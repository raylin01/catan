const escape = value => String(value).replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const terminal = status => ['won','ended','closed'].includes(status);

/** Only public lobby/recording metadata may enter crawler-visible HTML. */
export function shareMetadata({path='/',query={},origin,siteName='Catan Online by rlin',service}) {
  const base={siteName,title:siteName,description:'Build settlements, trade with friends, and bring your own AI players. Play Catan in your browser and replay every match.',path:'/',image:'home',unlisted:false,status:200};
  const missing=()=>({...base,title:`Link unavailable · ${siteName}`,description:'This room or replay could not be found. Ask its host for a new link.',unlisted:true,status:404});
  const roomMatch=/^\/watch\/([a-f\d]{8})\/?$/i.exec(path);
  if(roomMatch || (path==='/' && Object.hasOwn(query,'room'))) {
    const code=roomMatch?.[1]||query.room;
    if(typeof code!=='string'||!/^[a-f\d]{8}$/i.test(code))return missing();
    const room=service.invitation(code.toUpperCase());if(!room.success)return missing();
    const spectator=!!roomMatch||query.role==='spectator';
    if(terminal(room.status))return {...base,redirect:`/replay/${encodeURIComponent(room.replayId)}`,unlisted:true};
    return {...base,title:`${spectator?'Watch':'Join'} ${room.name} · ${siteName}`,description:spectator?'Watch this Catan table live. Follow the roads, trades and turns, then revisit the match in its replay.':`Join a ${room.seatCount}-seat Catan table with friends and their AI players. Choose an open seat and get ready to play.`,path:spectator?`/watch/${room.code}`:`/?room=${room.code}&role=human`,image:spectator?'watch':'join',unlisted:true};
  }
  const replayMatch=/^\/replay\/([A-Za-z0-9_-]{43})\/?$/.exec(path);
  if(replayMatch) {
    const result=service.recordingAccess(replayMatch[1],{perspective:'public'});if(!result.success)return missing();
    const recording=result.recording;
    const finished=terminal(recording.status);
    return {...base,title:`${recording.title || 'Catan match'} · Replay · ${siteName}`,description:finished?'Replay the match on a real-time timeline. Switch player perspectives, inspect every hand, and follow the game’s turning points.':'Follow this recorded Catan match so far. Private hands remain protected while the game can resume.',path:`/replay/${replayMatch[1]}`,image:'replay',unlisted:true};
  }
  if(path==='/replays'||path==='/replays/')return {...base,title:`Recording manager · ${siteName}`,description:'Private server-operator recording management. Open a shared replay link to watch a match.',path:'/replays',unlisted:true};
  if(path!=='/')return missing();
  return base;
}

export function renderShareHtml(template,metadata,origin) {
  const url=new URL(metadata.path,origin).href;
  const image=new URL(`/social/${metadata.image}.png`,origin).href;
  const meta=(attribute,key,value)=>`<meta ${attribute}="${key}" content="${escape(value)}" />`;
  const tags=[
    meta('name','description',metadata.description),
    `<link rel="canonical" href="${escape(url)}" />`,
    meta('property','og:type','website'),meta('property','og:site_name',metadata.siteName),
    meta('property','og:title',metadata.title),meta('property','og:description',metadata.description),meta('property','og:url',url),
    meta('property','og:image',image),meta('property','og:image:type','image/png'),meta('property','og:image:width','1200'),meta('property','og:image:height','630'),
    meta('property','og:image:alt','Catan Online: an illustrated island board with settlements, roads and dice'),
    meta('name','twitter:card','summary_large_image'),meta('name','twitter:title',metadata.title),meta('name','twitter:description',metadata.description),meta('name','twitter:image',image),
    ...(metadata.unlisted?[meta('name','robots','noindex, noarchive')]:[])
  ].join('\n    ');
  return template.replace(/<title>.*?<\/title>/s,`<title>${escape(metadata.title)}</title>`).replace('</head>',`    ${tags}\n  </head>`);
}
