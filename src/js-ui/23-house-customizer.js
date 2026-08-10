/* ============================================================================
   House · Tree · Pet customizer — the living-house decor layer.
   Builders (trees + pets + helpers) are ported VERBATIM from
   mockups/house-customizer.html (the harmonized, collision-fixed source of
   truth). This file adds the app integration seam on top of them:
     • buildHouseShell(kind,phase,winsInner,act) — the house shell, injecting
       the app's real door + member windows instead of the mock's samples.
     • houseCfg() / pickHouse() — the {house,tree,pet} config store, optimistic
       + persisted through window.setFamilyHouse().
     • openHouseToolbox() — the 3-picker bottom sheet ("Chăm chút tổ ấm").
   Loads after 22-home.js (same global scope), so renderScene() can call in.
   ============================================================================ */

/* ---------------------------------------------------------------------------
   TREES — svgOak / svgCherry / svgPine / svgWillow / svgKumquat   [batch-trees]
   bird() uses var(--perch-bird) (deduped against the pet robin's var(--bird)).
   --------------------------------------------------------------------------- */
var UID=0;
function P(s){return s + s.replace(/(fill|stroke)="[^"]*"/g,'$1="var(--dim)"');}
function rimArc(cx,cy,r){
  var rr=r-1.5;
  var x1=cx+rr*.42, y1=cy-rr*.91, x2=cx+rr*.91, y2=cy+rr*.42;
  return '<path d="M'+x1.toFixed(1)+' '+y1.toFixed(1)+' A'+rr+' '+rr+' 0 0 1 '+x2.toFixed(1)+' '+y2.toFixed(1)+'" '
   +'fill="none" stroke="rgba(255,185,95,.55)" stroke-width="3" stroke-linecap="round"/>';
}
function roundPoly(pts,r){
  function off(a,b){var dx=b[0]-a[0],dy=b[1]-a[1],L=Math.hypot(dx,dy);return[a[0]+dx/L*r,a[1]+dy/L*r];}
  var d='';
  for(var i=0;i<pts.length;i++){
    var p=pts[i],prev=pts[(i-1+pts.length)%pts.length],next=pts[(i+1)%pts.length];
    var pin=off(p,prev),pout=off(p,next);
    d+=(i?'L':'M')+pin[0].toFixed(1)+' '+pin[1].toFixed(1)
      +' Q'+p[0]+' '+p[1]+' '+pout[0].toFixed(1)+' '+pout[1].toFixed(1)+' ';
  }
  return d+'Z';
}
function shadowOf(phase){
  if(phase==='dusk')  return '<ellipse cx="18" cy="90" rx="30" ry="2.6" fill="rgba(60,42,52,.20)"/>';
  if(phase==='night') return '<ellipse cx="32" cy="90" rx="14" ry="2.1" fill="rgba(10,15,35,.25)"/>';
  return '<ellipse cx="32" cy="90" rx="16" ry="2.3" fill="var(--gshadow)"/>';
}
function dew(pts){
  return pts.map(function(p){return '<circle cx="'+p[0]+'" cy="'+p[1]+'" r="1.3" fill="rgba(255,255,255,.55)"/>';}).join('');
}
function bird(x,y){
  return '<g transform="translate('+x+','+y+')">'
   +'<rect x="3.2" y="4.2" width="8" height="6.2" rx="3.1" fill="var(--perch-bird)"/>'
   +'<path d="M10.6 6 L14.6 4.2 L11.8 8.6 Z" fill="#c94f3e"/>'
   +'<ellipse cx="7.4" cy="7" rx="2.5" ry="1.7" fill="rgba(70,20,14,.18)"/>'
   +'<circle cx="3.6" cy="3.6" r="3" fill="var(--perch-bird)"/>'
   +'<path d="M1 3.2 L-1.8 4.1 L1 5.1 Z" fill="var(--gold)"/>'
   +'<circle cx="2.8" cy="3" r=".75" fill="#3a2a22"/>'
   +'</g>';
}
function svgOak(phase){
  var body=P('<rect x="27.5" y="58" width="9" height="34" rx="4.5" fill="var(--wood)"/>')
   +P('<circle cx="32" cy="28" r="24" fill="var(--brand-2)"/>')
   +P('<circle cx="15" cy="45" r="15" fill="var(--brand-2)"/>')
   +P('<circle cx="47" cy="43" r="17" fill="var(--brand-2)"/>')
   +'<path d="M14 51 A22 22 0 0 0 50 50" fill="none" stroke="rgba(26,90,60,.10)" stroke-width="5" stroke-linecap="round"/>';
  var extra='';
  if(phase==='dusk') extra=rimArc(32,28,24);
  if(phase==='dawn') extra=dew([[21,16],[41,11],[30,37]])+bird(33,-4);
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}
function svgCherry(phase){
  var cf = phase==='night' ? 'var(--blossom-moon)' : 'var(--blossom)';
  var df = phase==='night' ? '#efe6f0' : 'var(--blossom-pale)';
  var dp = phase==='night' ? 'rgba(95,75,115,.12)' : 'rgba(190,95,135,.10)';
  var dots='<circle cx="21" cy="14" r="1.9" fill="'+df+'"/>'
   +'<circle cx="42" cy="10" r="1.9" fill="'+df+'"/>'
   +'<circle cx="51" cy="30" r="1.8" fill="'+df+'"/>'
   +'<circle cx="11" cy="41" r="1.7" fill="'+df+'"/>'
   +'<circle cx="33" cy="38" r="1.8" fill="'+df+'"/>'
   +'<circle cx="27" cy="24" r="1.7" fill="'+df+'"/>';
  var body=P('<rect x="27.5" y="58" width="9" height="34" rx="4.5" fill="var(--wood)"/>')
   +P('<circle cx="32" cy="28" r="24" fill="'+cf+'"/>')
   +P('<circle cx="15" cy="45" r="15" fill="'+cf+'"/>')
   +P('<circle cx="47" cy="43" r="17" fill="'+cf+'"/>')
   +'<path d="M14 51 A22 22 0 0 0 50 50" fill="none" stroke="'+dp+'" stroke-width="5" stroke-linecap="round"/>'
   +P(dots);
  var extra='';
  if(phase==='dusk') extra=rimArc(32,28,24);
  if(phase==='dawn') extra=dew([[24,18],[44,14]])+bird(33,-4);
  if(phase==='day') extra='<g>'
    +'<ellipse class="petal"     cx="57" cy="16" rx="2.8" ry="1.7" fill="var(--blossom-pale)"/>'
    +'<ellipse class="petal pt2" cx="54" cy="30" rx="2.6" ry="1.6" fill="var(--blossom-pale)"/>'
    +'<ellipse class="petal pt3" cx="60" cy="38" rx="2.5" ry="1.5" fill="var(--blossom)"/>'
    +'<ellipse class="petal pt4" cx="51" cy="10" rx="2.3" ry="1.4" fill="var(--blossom-pale)"/>'
    +'</g>';
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}
function svgPine(phase){
  function tier(ay,by,hw){
    return '<path d="'+roundPoly([[32,ay],[32+hw,by],[32-hw,by]],4.5)+'" fill="var(--leaf-2)"/>';
  }
  var body=P('<rect x="28.5" y="72" width="7" height="20" rx="3.5" fill="var(--wood)"/>')
   +P(tier(29,76,26.5))
   +'<rect x="15" y="58.5" width="34" height="3" rx="1.5" fill="rgba(18,68,46,.14)"/>'
   +P(tier(15,57,21.5))
   +'<rect x="19" y="39.5" width="26" height="3" rx="1.5" fill="rgba(18,68,46,.14)"/>'
   +P(tier(3,38,16.5));
  var extra='';
  if(phase==='dusk') extra='<path d="M36.3 15.3 L44 31" stroke="rgba(255,185,95,.55)" stroke-width="3" stroke-linecap="round" fill="none"/>'
   +'<path d="M37 27.6 L46.6 46.5" stroke="rgba(255,185,95,.45)" stroke-width="3" stroke-linecap="round" fill="none"/>'
   +'<path d="M37.1 40.8 L47.7 59.6" stroke="rgba(255,185,95,.36)" stroke-width="3" stroke-linecap="round" fill="none"/>';
  if(phase==='dawn') extra=dew([[26,30],[37,48]])+bird(27,-9);
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}
function svgWillow(phase){
  var fronds=[
    [ 2.5,6,26,71,1],[ 9.5,7,30,78,0],[17.5,6,34,68,1],[24.5,6,36,60,0],
    [33.5,6,36,58,1],[40.5,6,34,72,0],[47.5,7,30,79,1],[55.5,6,26,72,0]
  ].map(function(f){
    return '<rect x="'+f[0]+'" y="'+f[2]+'" width="'+f[1]+'" height="'+(f[3]-f[2])
     +'" rx="'+(f[1]/2)+'" fill="var(--'+(f[4]?'leaf-2':'brand-2')+')"/>';
  }).join('');
  var body=P('<rect x="28" y="52" width="8" height="40" rx="4" fill="var(--wood)"/>')
   +P(fronds)
   +P('<circle cx="16" cy="29" r="13" fill="var(--brand-2)"/>')
   +P('<circle cx="48" cy="27" r="14" fill="var(--brand-2)"/>')
   +P('<circle cx="32" cy="21" r="20" fill="var(--brand-2)"/>');
  var extra='';
  if(phase==='dusk') extra=rimArc(32,21,20);
  if(phase==='dawn') extra=dew([[24,14],[42,20]])+bird(33,-7);
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}
function svgKumquat(phase){
  /* planted in the ground like every other tree — the Tết pot was the one
     man-made prop left in the nature scene, so it's gone */
  var fruit='<circle cx="23" cy="20" r="2.7" fill="var(--kumquat)"/>'
   +'<circle cx="40" cy="15" r="2.6" fill="var(--kumquat)"/>'
   +'<circle cx="31" cy="33" r="2.7" fill="var(--kumquat)"/>'
   +'<circle cx="14" cy="42" r="2.4" fill="var(--kumquat)"/>'
   +'<circle cx="48" cy="37" r="2.5" fill="var(--kumquat)"/>'
   +'<circle cx="42" cy="45" r="2.4" fill="var(--kumquat)"/>'
   +'<circle cx="22" cy="46" r="2.3" fill="var(--kumquat)"/>';
  var body=P('<rect x="29.5" y="52" width="5" height="40" rx="2.5" fill="var(--wood)"/>')
   +P('<circle cx="32" cy="31" r="20" fill="var(--leaf-2)"/>')
   +P('<circle cx="17" cy="43" r="11" fill="var(--leaf-2)"/>')
   +P('<circle cx="47" cy="41" r="12" fill="var(--leaf-2)"/>')
   +'<path d="M18 48 A19 19 0 0 0 46 47" fill="none" stroke="rgba(20,70,48,.10)" stroke-width="4" stroke-linecap="round"/>'
   +P(fruit);
  var extra='';
  if(phase==='dusk') extra=rimArc(32,31,20);
  if(phase==='dawn') extra=dew([[27,22],[42,28]])+bird(26,0);
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}
/* mango — the classic Vietnamese yard tree: a broad theme-green crown with
   golden fruit hanging off the lower arc (same oak geometry, fruit like the
   kumquat's but pendant ellipses) */
function svgMango(phase){
  var fruit='<ellipse cx="19" cy="49" rx="2.6" ry="3.4" fill="var(--mango)"/>'
   +'<ellipse cx="31" cy="52" rx="2.7" ry="3.5" fill="var(--mango)"/>'
   +'<ellipse cx="44" cy="49" rx="2.6" ry="3.4" fill="var(--mango)"/>'
   +'<ellipse cx="53" cy="43" rx="2.4" ry="3.2" fill="var(--mango)"/>'
   +'<ellipse cx="12" cy="46" rx="2.3" ry="3.1" fill="var(--mango)"/>';
  var body=P('<rect x="27.5" y="58" width="9" height="34" rx="4.5" fill="var(--wood)"/>')
   +P('<circle cx="32" cy="27" r="21" fill="var(--brand-2)"/>')
   +P('<circle cx="13" cy="38" r="13" fill="var(--brand-2)"/>')
   +P('<circle cx="51" cy="36" r="14" fill="var(--brand-2)"/>')
   +'<path d="M12 44 A24 24 0 0 0 52 43" fill="none" stroke="rgba(26,90,60,.10)" stroke-width="5" stroke-linecap="round"/>'
   +P(fruit);
  var extra='';
  if(phase==='dusk') extra=rimArc(32,27,21);
  if(phase==='dawn') extra=dew([[22,15],[42,11],[30,34]])+bird(33,-5);
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}
/* coconut palm — a whole different silhouette: a gently curving trunk with
   ring marks, eight capsule fronds fanned from one crown point (alternating
   the two greens like the willow), and a cluster of husks at the heart */
function svgCoconut(phase){
  function frond(ang,len,col){
    return '<rect x="36" y="27.5" width="'+len+'" height="5" rx="2.5" fill="var(--'+col+')" transform="rotate('+ang+' 36 30)"/>';
  }
  var fronds=P(frond(-62,19,'leaf-2')+frond(242,19,'brand-2')
   +frond(-18,23,'brand-2')+frond(198,23,'leaf-2')
   +frond(14,24,'leaf-2')+frond(166,24,'brand-2')
   +frond(46,21,'brand-2')+frond(134,21,'leaf-2'));
  var body=P('<path d="M29 92 Q27 60 33 32 L38.5 33 Q34 62 37 92 Z" fill="var(--wood)"/>')
   +'<path d="M30.6 76 L36.3 76.6" stroke="rgba(55,35,20,.20)" stroke-width="2" stroke-linecap="round"/>'
   +'<path d="M31.4 62 L36.6 62.6" stroke="rgba(55,35,20,.20)" stroke-width="2" stroke-linecap="round"/>'
   +'<path d="M32.4 48 L37 48.5" stroke="rgba(55,35,20,.20)" stroke-width="2" stroke-linecap="round"/>'
   +fronds
   +P('<circle cx="32" cy="35.5" r="3.1" fill="var(--wood-2)"/>')
   +P('<circle cx="39" cy="36.5" r="3" fill="var(--wood-2)"/>')
   +P('<circle cx="35.5" cy="40" r="2.9" fill="var(--wood-2)"/>');
  var extra='';
  if(phase==='dusk') extra='<path d="M40 24 Q52 20 58 29" stroke="rgba(255,185,95,.55)" stroke-width="3" stroke-linecap="round" fill="none"/>'
   +'<path d="M42 32 Q53 34 57 42" stroke="rgba(255,185,95,.4)" stroke-width="3" stroke-linecap="round" fill="none"/>';
  if(phase==='dawn') extra=dew([[24,22],[46,26]])+bird(40,12);
  return '<svg viewBox="0 0 64 92" aria-hidden="true">'+shadowOf(phase)+body+extra+'</svg>';
}

/* ---------------------------------------------------------------------------
   PETS — svgDog / svgCat / svgRabbit / svgBird / svgDuck   [batch-pets]
   duck gradient id prefixed p_pd (family-unique) + salted per instance.
   --------------------------------------------------------------------------- */
var _uid = 0;
function zz(x,y,s){
  s = s || 1;
  return '<g transform="translate('+x+' '+y+') scale('+s+')"><g class="zz">'
    + '<path d="M0 3 C2.6 -1.8 8.6 -1 8 2.6 C7.5 5.6 3.4 6 2.5 3.6 C1.8 1.7 3.6 .4 5.2 1.1" '
    + 'fill="none" stroke="rgba(255,255,255,.85)" stroke-width="1.6" stroke-linecap="round"/>'
    + '<circle cx="11.5" cy="-2.5" r="1.15" fill="rgba(255,255,255,.7)"/>'
    + '</g></g>';
}
function svgDog(phase){
  var b = '';
  if(phase === 'day'){
    b = '<ellipse cx="25" cy="42" rx="15" ry="2.4" fill="var(--gshadow)"/>'
      + '<rect x="36.5" y="13" width="4.8" height="13" rx="2.4" fill="var(--coat)" transform="rotate(30 38.9 19.5)"/>'
      + '<circle cx="30" cy="30" r="11.5" fill="var(--coat)"/>'
      + '<ellipse cx="20" cy="26" rx="9" ry="13" fill="var(--coat)" transform="rotate(-10 20 26)"/>'
      + '<ellipse cx="17.5" cy="28" rx="4.6" ry="8.5" fill="var(--coat-cream)"/>'
      + '<rect x="13.5" y="30" width="4.6" height="11.5" rx="2.3" fill="var(--coat)"/>'
      + '<rect x="20" y="30" width="4.6" height="11.5" rx="2.3" fill="var(--coat)"/>'
      + '<rect x="9.5" y="17.5" width="13.5" height="3.6" rx="1.8" fill="var(--brand-ink)" transform="rotate(-9 16 19.5)"/>'
      + '<circle cx="16.9" cy="21.9" r="1.35" fill="var(--gold)"/>'
      + '<circle cx="16" cy="11" r="9.2" fill="var(--coat)"/>'
      + '<ellipse cx="10.3" cy="14" rx="5" ry="3.9" fill="var(--coat-cream)"/>'
      + '<circle cx="6.9" cy="12.6" r="2" fill="var(--snout)"/>'
      + '<circle cx="13.8" cy="9" r="1.7" fill="var(--snout)"/>'
      + '<ellipse cx="21.8" cy="13.5" rx="3.8" ry="7" fill="var(--wood-2)" transform="rotate(10 21.8 13.5)"/>';
  }
  else if(phase === 'dawn'){
    b = '<ellipse cx="24" cy="42" rx="16" ry="2.4" fill="var(--gshadow)"/>'
      + '<rect x="37" y="7" width="4.6" height="12.5" rx="2.3" fill="var(--coat)" transform="rotate(38 39.3 13.2)"/>'
      + '<circle cx="33.5" cy="28" r="10" fill="var(--coat)"/>'
      + '<rect x="31" y="31" width="4.6" height="10.5" rx="2.3" fill="var(--coat)"/>'
      + '<ellipse cx="23" cy="32.5" rx="11" ry="7.2" fill="var(--coat)" transform="rotate(12 23 32.5)"/>'
      + '<ellipse cx="15.5" cy="35" rx="5" ry="4" fill="var(--coat-cream)"/>'
      + '<rect x="2.5" y="37.4" width="13" height="4.4" rx="2.2" fill="var(--coat)"/>'
      + '<rect x="5.5" y="38.6" width="12" height="4" rx="2" fill="var(--coat)"/>'
      + '<rect x="7" y="26" width="12.5" height="3.4" rx="1.7" fill="var(--brand-ink)" transform="rotate(20 13 27.5)"/>'
      + '<circle cx="12.2" cy="30.6" r="1.3" fill="var(--gold)"/>'
      + '<circle cx="11" cy="21" r="8.4" fill="var(--coat)"/>'
      + '<ellipse cx="5.8" cy="24" rx="4.6" ry="3.6" fill="var(--coat-cream)"/>'
      + '<circle cx="2.9" cy="22.6" r="1.9" fill="var(--snout)"/>'
      + '<circle cx="8.8" cy="19" r="1.6" fill="var(--snout)"/>'
      + '<ellipse cx="16.5" cy="23" rx="3.6" ry="6.6" fill="var(--wood-2)" transform="rotate(14 16.5 23)"/>';
  }
  else if(phase === 'dusk'){
    b = '<g transform="translate(48 0) scale(-1 1)">'
      + '<ellipse cx="25" cy="42" rx="15" ry="2.3" fill="var(--gshadow)"/>'
      + '<rect x="37" y="13" width="4.6" height="12" rx="2.3" fill="var(--coat)" transform="rotate(46 39.3 19)"/>'
      + '<ellipse cx="25" cy="26.5" rx="13" ry="8.6" fill="var(--coat)"/>'
      + '<rect x="15" y="31" width="4.4" height="11" rx="2.2" fill="var(--coat)"/>'
      + '<rect x="21.5" y="32.5" width="4.4" height="9.5" rx="2.2" fill="var(--coat)"/>'
      + '<rect x="29" y="31" width="4.4" height="11" rx="2.2" fill="var(--coat)"/>'
      + '<rect x="34" y="32.5" width="4.4" height="9.5" rx="2.2" fill="var(--coat)"/>'
      + '<ellipse cx="15.5" cy="27.5" rx="4" ry="6" fill="var(--coat-cream)"/>'
      + '<rect x="8.5" y="16.5" width="12.5" height="3.4" rx="1.7" fill="var(--brand-ink)" transform="rotate(-24 14.7 18.2)"/>'
      + '<circle cx="14.6" cy="21.2" r="1.3" fill="var(--gold)"/>'
      + '<circle cx="11.5" cy="12" r="8.6" fill="var(--coat)"/>'
      + '<ellipse cx="5.8" cy="15" rx="4.8" ry="3.7" fill="var(--coat-cream)"/>'
      + '<circle cx="2.7" cy="13.5" r="1.9" fill="var(--snout)"/>'
      + '<circle cx="9" cy="10" r="1.6" fill="var(--snout)"/>'
      + '<ellipse cx="17" cy="14.5" rx="3.7" ry="6.8" fill="var(--wood-2)" transform="rotate(10 17 14.5)"/>'
      + '</g>';
  }
  else{
    b = '<ellipse cx="23" cy="41.5" rx="14" ry="2.2" fill="var(--gshadow)"/>'
      + '<circle cx="24" cy="30.5" r="11.5" fill="var(--coat)"/>'
      + '<circle cx="30.5" cy="32.5" r="6.5" fill="rgba(90,60,35,.12)"/>'
      + '<rect x="10.5" y="34.6" width="18" height="5.4" rx="2.7" fill="var(--coat)"/>'
      + '<ellipse cx="12.5" cy="37.3" rx="3" ry="2.4" fill="var(--coat-cream)"/>'
      + '<rect x="14.5" y="31.6" width="9" height="3" rx="1.5" fill="var(--brand-ink)" transform="rotate(-14 19 33)"/>'
      + '<circle cx="14.3" cy="33.6" r="1.2" fill="var(--gold)"/>'
      + '<circle cx="14.5" cy="26.5" r="7.8" fill="var(--coat)"/>'
      + '<ellipse cx="9.6" cy="29.4" rx="4.2" ry="3.3" fill="var(--coat-cream)"/>'
      + '<circle cx="6.7" cy="28" r="1.7" fill="var(--snout)"/>'
      + '<path d="M10.6 25.2 q1.6 1.7 3.2 0" fill="none" stroke="var(--snout)" stroke-width="1.3" stroke-linecap="round"/>'
      + '<ellipse cx="19.8" cy="27.5" rx="3.4" ry="6" fill="var(--wood-2)" transform="rotate(20 19.8 27.5)"/>';
  }
  return '<svg viewBox="0 0 48 44" aria-hidden="true"><g class="pb">'+b+'</g>'
    + (phase==='night' ? zz(6,11,1) : '') + '</svg>';
}
function svgCat(phase){
  var b = '';
  var earL = '<path d="M9 8.5 L10.6 1.4 L15.4 5.6 Z" fill="var(--cat)"/>'
           + '<path d="M10.4 7.2 L11.2 3.6 L13.6 5.8 Z" fill="var(--ear-blush)"/>';
  var earR = '<path d="M15.8 5.6 L20.6 1.4 L22.2 8.5 Z" fill="var(--cat)"/>'
           + '<path d="M17.6 5.8 L20 3.6 L20.8 7.2 Z" fill="var(--ear-blush)"/>';
  if(phase === 'day'){
    b = '<ellipse cx="22" cy="42" rx="13" ry="2.2" fill="var(--gshadow)"/>'
      + '<path d="M29 40 Q38.5 39.5 37 30.5" fill="none" stroke="var(--cat)" stroke-width="4.6" stroke-linecap="round"/>'
      + '<circle cx="37" cy="31" r="2.3" fill="var(--cat)"/>'
      + '<circle cx="27.5" cy="31.5" r="9" fill="var(--cat)"/>'
      + '<ellipse cx="19.5" cy="27" rx="8.6" ry="12" fill="var(--cat)" transform="rotate(-6 19.5 27)"/>'
      + '<ellipse cx="17.5" cy="29.5" rx="4.2" ry="7.6" fill="var(--coat-cream)"/>'
      + '<rect x="13.5" y="30" width="4.2" height="11.5" rx="2.1" fill="var(--cat)"/>'
      + '<rect x="19.5" y="30" width="4.2" height="11.5" rx="2.1" fill="var(--cat)"/>'
      + '<rect x="23.5" y="20.8" width="6" height="2" rx="1" fill="rgba(88,66,58,.17)" transform="rotate(42 26.5 21.8)"/>'
      + '<rect x="26.5" y="25.5" width="5.5" height="2" rx="1" fill="rgba(88,66,58,.17)" transform="rotate(42 29.2 26.5)"/>'
      + '<rect x="9.5" y="17.4" width="12.5" height="3.4" rx="1.7" fill="var(--brand-ink)" transform="rotate(-8 15.7 19.1)"/>'
      + '<circle cx="16" cy="21.4" r="1.3" fill="var(--gold)"/>'
      + earL + earR
      + '<circle cx="15.5" cy="11.5" r="7.8" fill="var(--cat)"/>'
      + '<rect x="12.6" y="4.6" width="1.8" height="3.6" rx=".9" fill="rgba(88,66,58,.2)"/>'
      + '<rect x="16.4" y="4.2" width="1.8" height="3.8" rx=".9" fill="rgba(88,66,58,.2)"/>'
      + '<circle cx="12.6" cy="10.8" r="1.45" fill="var(--snout)"/>'
      + '<circle cx="18.4" cy="10.8" r="1.45" fill="var(--snout)"/>'
      + '<path d="M14.8 13.6 L16.4 13.6 L15.6 14.9 Z" fill="var(--snout)"/>';
  }
  else if(phase === 'dawn'){
    b = '<ellipse cx="21" cy="42" rx="14.5" ry="2.3" fill="var(--gshadow)"/>'
      + '<path d="M33.5 26.5 Q41.8 20 37 10.5" fill="none" stroke="var(--cat)" stroke-width="4.6" stroke-linecap="round"/>'
      + '<circle cx="30.5" cy="29.5" r="8.6" fill="var(--cat)"/>'
      + '<rect x="28" y="32" width="4.2" height="9.5" rx="2.1" fill="var(--cat)"/>'
      + '<ellipse cx="21" cy="33.5" rx="10.5" ry="6.2" fill="var(--cat)" transform="rotate(10 21 33.5)"/>'
      + '<rect x="3" y="37.8" width="12" height="4" rx="2" fill="var(--cat)"/>'
      + '<rect x="26" y="25.5" width="6" height="2" rx="1" fill="rgba(88,66,58,.2)" transform="rotate(26 29 26.5)"/>'
      + '<rect x="24" y="30" width="6" height="2" rx="1" fill="rgba(88,66,58,.2)" transform="rotate(26 27 31)"/>'
      + '<rect x="6" y="30.5" width="11.5" height="3.2" rx="1.6" fill="var(--brand-ink)" transform="rotate(22 11.7 32)"/>'
      + '<circle cx="10.4" cy="34.8" r="1.25" fill="var(--gold)"/>'
      + '<path d="M4.2 23.6 L4.6 16.6 L9.4 20.4 Z" fill="var(--cat)"/>'
      + '<path d="M10.6 19.8 L15.4 16.9 L14.6 23.4 Z" fill="var(--cat)"/>'
      + '<circle cx="9.5" cy="27" r="7" fill="var(--cat)"/>'
      + '<circle cx="6.6" cy="26.2" r="1.4" fill="var(--snout)"/>'
      + '<circle cx="12" cy="25.6" r="1.4" fill="var(--snout)"/>'
      + '<path d="M8.6 29.2 L10.2 29.2 L9.4 30.5 Z" fill="var(--snout)"/>';
  }
  else if(phase === 'dusk'){
    b = '<g transform="translate(44 0) scale(-1 1)">'
      + '<ellipse cx="22" cy="42" rx="14" ry="2.2" fill="var(--gshadow)"/>'
      + '<path d="M36 27.5 Q42.5 22 39.5 14" fill="none" stroke="var(--cat)" stroke-width="4" stroke-linecap="round"/>'
      + '<ellipse cx="24" cy="29" rx="13" ry="6.8" fill="var(--cat)"/>'
      + '<rect x="14" y="32" width="3.8" height="10" rx="1.9" fill="var(--cat)"/>'
      + '<rect x="20" y="33.5" width="3.8" height="8.5" rx="1.9" fill="var(--cat)"/>'
      + '<rect x="28" y="32" width="3.8" height="10" rx="1.9" fill="var(--cat)"/>'
      + '<rect x="33.5" y="33.5" width="3.8" height="8.5" rx="1.9" fill="var(--cat)"/>'
      + '<ellipse cx="14" cy="28" rx="3.6" ry="4.8" fill="var(--coat-cream)"/>'
      + '<rect x="22" y="24.6" width="6" height="2" rx="1" fill="rgba(88,66,58,.2)" transform="rotate(8 25 25.6)"/>'
      + '<rect x="28.5" y="26" width="6" height="2" rx="1" fill="rgba(88,66,58,.2)" transform="rotate(8 31.5 27)"/>'
      + '<rect x="6.5" y="21.5" width="11" height="3.2" rx="1.6" fill="var(--brand-ink)" transform="rotate(-30 12 23)"/>'
      + '<circle cx="11.5" cy="25.6" r="1.25" fill="var(--gold)"/>'
      + '<path d="M4.6 16.6 L5.6 9.6 L10.2 13.6 Z" fill="var(--cat)"/>'
      + '<path d="M11.4 13.2 L16 10 L15.6 16.8 Z" fill="var(--cat)"/>'
      + '<circle cx="10.5" cy="19.5" r="7" fill="var(--cat)"/>'
      + '<circle cx="7.4" cy="18.4" r="1.4" fill="var(--snout)"/>'
      + '<circle cx="13" cy="18" r="1.4" fill="var(--snout)"/>'
      + '<path d="M9.2 21.4 L10.8 21.4 L10 22.7 Z" fill="var(--snout)"/>'
      + '</g>';
  }
  else{
    b = '<ellipse cx="22" cy="41.5" rx="13" ry="2.1" fill="var(--gshadow)"/>'
      + '<circle cx="23" cy="31.5" r="10.5" fill="var(--cat)"/>'
      + '<circle cx="28.5" cy="33.5" r="6" fill="rgba(88,66,58,.1)"/>'
      + '<rect x="21" y="24" width="6.5" height="2" rx="1" fill="rgba(88,66,58,.2)" transform="rotate(24 24 25)"/>'
      + '<rect x="25" y="28" width="6" height="2" rx="1" fill="rgba(88,66,58,.2)" transform="rotate(24 28 29)"/>'
      + '<path d="M12 36 Q22.5 41.5 33 35.8" fill="none" stroke="var(--cat)" stroke-width="4.4" stroke-linecap="round"/>'
      + '<path d="M6.2 26.2 L7.4 20.2 L11.4 23.8 Z" fill="var(--cat)"/>'
      + '<path d="M12.4 23.4 L16.6 20.6 L16.2 26.2 Z" fill="var(--cat)"/>'
      + '<circle cx="14" cy="28.5" r="6.8" fill="var(--cat)"/>'
      + '<ellipse cx="11.6" cy="31.2" rx="3.7" ry="2.7" fill="var(--coat-cream)"/>'
      + '<path d="M9.8 27.4 q1.4 1.5 2.8 0" fill="none" stroke="var(--snout)" stroke-width="1.2" stroke-linecap="round"/>'
      + '<path d="M15.4 27 q1.4 1.5 2.8 0" fill="none" stroke="var(--snout)" stroke-width="1.2" stroke-linecap="round"/>'
      + '<path d="M11.9 29.9 L13.5 29.9 L12.7 31.2 Z" fill="var(--snout)"/>'
      + '<rect x="17.5" y="32.8" width="6.5" height="2.8" rx="1.4" fill="var(--brand-ink)" transform="rotate(-18 20.7 34.2)"/>'
      + '<circle cx="17.4" cy="34.6" r="1.15" fill="var(--gold)"/>';
  }
  return '<svg viewBox="0 0 44 44" aria-hidden="true"><g class="pb">'+b+'</g>'
    + (phase==='night' ? zz(5,12,.95) : '') + '</svg>';
}
function svgRabbit(phase){
  var b = '';
  if(phase === 'day'){
    b = '<ellipse cx="19" cy="44" rx="13" ry="2.2" fill="var(--gshadow)"/>'
      + '<ellipse cx="22" cy="34.5" rx="11.5" ry="9.5" fill="var(--coat-cream)"/>'
      + '<circle cx="27.5" cy="35.5" r="7" fill="rgba(120,95,70,.12)"/>'
      + '<circle cx="33" cy="30.5" r="3.4" fill="#fdf4e2"/>'
      + '<rect x="2" y="14" width="5" height="15" rx="2.5" fill="var(--coat-cream)" transform="rotate(-40 4.5 21.5)"/>'
      + '<rect x="8.5" y="12" width="5" height="15.5" rx="2.5" fill="var(--coat-cream)" transform="rotate(-22 11 19.8)"/>'
      + '<rect x="9.8" y="14.4" width="2.3" height="10.5" rx="1.15" fill="var(--ear-blush)" transform="rotate(-22 11 19.8)"/>'
      + '<rect x="7" y="24.5" width="10.5" height="3.2" rx="1.6" fill="var(--brand-ink)" transform="rotate(14 12 26)"/>'
      + '<circle cx="9.6" cy="27.6" r="1.25" fill="var(--gold)"/>'
      + '<circle cx="9.5" cy="32.5" r="7" fill="var(--coat-cream)"/>'
      + '<circle cx="7.2" cy="30.8" r="1.4" fill="var(--snout)"/>'
      + '<circle cx="3.2" cy="33.4" r="1.25" fill="var(--snout)"/>'
      + '<rect x="10" y="39.5" width="8" height="4" rx="2" fill="var(--coat-cream)"/>'
      + '<rect x="10" y="39.5" width="8" height="4" rx="2" fill="rgba(120,95,70,.08)"/>'
      + '<rect x="1.6" y="39" width="1.4" height="4.5" rx=".7" fill="#57a86a"/>'
      + '<circle cx="1.4" cy="38" r="1.5" fill="#57a86a"/><circle cx="3.4" cy="37.6" r="1.5" fill="#57a86a"/><circle cx="2.4" cy="36.2" r="1.5" fill="#57a86a"/>';
  }
  else if(phase === 'dawn'){
    b = '<ellipse cx="20" cy="44" rx="15" ry="2.3" fill="var(--gshadow)"/>'
      + '<circle cx="30" cy="34.5" r="7.5" fill="var(--coat-cream)"/>'
      + '<circle cx="30" cy="34.5" r="7.5" fill="rgba(120,95,70,.07)"/>'
      + '<circle cx="34.5" cy="28.5" r="3.2" fill="#fdf4e2"/>'
      + '<ellipse cx="20" cy="37" rx="13" ry="6.6" fill="var(--coat-cream)"/>'
      + '<rect x="2.5" y="39.6" width="11" height="4" rx="2" fill="var(--coat-cream)"/>'
      + '<rect x="2.5" y="39.6" width="11" height="4" rx="2" fill="rgba(120,95,70,.07)"/>'
      + '<rect x="11" y="16.5" width="4.8" height="16" rx="2.4" fill="var(--coat-cream)" transform="rotate(-54 13.4 24.5)"/>'
      + '<rect x="12" y="18.5" width="2.2" height="11" rx="1.1" fill="var(--ear-blush)" transform="rotate(-54 13.4 24.5)"/>'
      + '<rect x="12.5" y="22.5" width="4.8" height="14" rx="2.4" fill="var(--coat-cream)" transform="rotate(-76 14.9 29.5)"/>'
      + '<rect x="12.5" y="22.5" width="4.8" height="14" rx="2.4" fill="rgba(120,95,70,.08)" transform="rotate(-76 14.9 29.5)"/>'
      + '<rect x="6" y="30.5" width="10" height="3" rx="1.5" fill="var(--brand-ink)" transform="rotate(18 11 32)"/>'
      + '<circle cx="8.8" cy="33.6" r="1.2" fill="var(--gold)"/>'
      + '<circle cx="8.5" cy="30.5" r="6.6" fill="var(--coat-cream)"/>'
      + '<circle cx="6.2" cy="28.9" r="1.35" fill="var(--snout)"/>'
      + '<circle cx="2.6" cy="31.4" r="1.2" fill="var(--snout)"/>';
  }
  else if(phase === 'dusk'){
    b = '<ellipse cx="20" cy="44" rx="9" ry="1.8" fill="var(--gshadow)" opacity=".85"/>'
      + '<circle cx="10" cy="25" r="3.2" fill="#fdf4e2"/>'
      + '<ellipse cx="19" cy="28" rx="11" ry="8.5" fill="var(--coat-cream)" transform="rotate(-16 19 28)"/>'
      + '<circle cx="14" cy="29.5" r="6.4" fill="rgba(120,95,70,.1)"/>'
      + '<rect x="5.5" y="32" width="11" height="4.2" rx="2.1" fill="var(--coat-cream)" transform="rotate(26 8 34)"/>'
      + '<rect x="5.5" y="32" width="11" height="4.2" rx="2.1" fill="rgba(120,95,70,.08)" transform="rotate(26 8 34)"/>'
      + '<circle cx="26" cy="31.5" r="2.3" fill="var(--coat-cream)"/>'
      + '<circle cx="29.5" cy="30" r="2.3" fill="var(--coat-cream)"/>'
      + '<rect x="17" y="6" width="4.8" height="14" rx="2.4" fill="var(--coat-cream)" transform="rotate(38 19.4 13)"/>'
      + '<rect x="18.1" y="8" width="2.2" height="10" rx="1.1" fill="var(--ear-blush)" transform="rotate(38 19.4 13)"/>'
      + '<rect x="13" y="6.5" width="4.8" height="13.5" rx="2.4" fill="var(--coat-cream)" transform="rotate(52 15.4 13.2)"/>'
      + '<rect x="13" y="6.5" width="4.8" height="13.5" rx="2.4" fill="rgba(120,95,70,.08)" transform="rotate(52 15.4 13.2)"/>'
      + '<rect x="22.5" y="22" width="10" height="3" rx="1.5" fill="var(--brand-ink)" transform="rotate(-18 27.5 23.5)"/>'
      + '<circle cx="30.4" cy="24.4" r="1.2" fill="var(--gold)"/>'
      + '<circle cx="29" cy="17.5" r="6.6" fill="var(--coat-cream)"/>'
      + '<circle cx="31.6" cy="15.9" r="1.35" fill="var(--snout)"/>'
      + '<circle cx="35.3" cy="18.3" r="1.2" fill="var(--snout)"/>';
  }
  else{
    b = '<ellipse cx="20" cy="44" rx="13.5" ry="2.2" fill="var(--gshadow)"/>'
      + '<ellipse cx="21" cy="35" rx="12.5" ry="9" fill="var(--coat-cream)"/>'
      + '<circle cx="27" cy="36" r="6.6" fill="rgba(120,95,70,.1)"/>'
      + '<circle cx="32.5" cy="31.5" r="3.4" fill="#fdf4e2"/>'
      + '<rect x="12.5" y="23.5" width="4.6" height="14" rx="2.3" fill="var(--coat-cream)" transform="rotate(-74 14.8 30.5)"/>'
      + '<rect x="13.6" y="25.5" width="2.1" height="9.5" rx="1.05" fill="var(--ear-blush)" transform="rotate(-74 14.8 30.5)"/>'
      + '<rect x="13" y="27" width="4.6" height="13.5" rx="2.3" fill="var(--coat-cream)" transform="rotate(-86 15.3 33.7)"/>'
      + '<rect x="13" y="27" width="4.6" height="13.5" rx="2.3" fill="rgba(120,95,70,.16)" transform="rotate(-86 15.3 33.7)"/>'
      + '<rect x="8" y="34" width="9" height="2.8" rx="1.4" fill="var(--brand-ink)" transform="rotate(10 12.5 35.4)"/>'
      + '<circle cx="9.9" cy="36.9" r="1.15" fill="var(--gold)"/>'
      + '<circle cx="10.5" cy="33" r="6.4" fill="var(--coat-cream)"/>'
      + '<path d="M6.9 31.6 q1.4 1.5 2.8 0" fill="none" stroke="var(--snout)" stroke-width="1.2" stroke-linecap="round"/>'
      + '<circle cx="4.6" cy="34.2" r="1.15" fill="var(--snout)"/>';
  }
  return '<svg viewBox="0 0 40 46" aria-hidden="true"><g class="pb">'+b+'</g>'
    + (phase==='night' ? zz(3,16,.9) : '') + '</svg>';
}
function svgBird(phase){
  var b = '';
  if(phase === 'day'){
    b = '<ellipse cx="13" cy="22.6" rx="7" ry="1.5" fill="var(--gshadow)"/>'
      + '<rect x="17.5" y="8" width="7" height="3.4" rx="1.7" fill="var(--bird-deep)" transform="rotate(-30 21 9.7)"/>'
      + '<ellipse cx="13" cy="14.5" rx="8" ry="6.2" fill="var(--bird)" transform="rotate(16 13 14.5)"/>'
      + '<ellipse cx="9.5" cy="18" rx="4.4" ry="3.2" fill="var(--coat-cream)" transform="rotate(16 9.5 18)"/>'
      + '<ellipse cx="14.5" cy="13" rx="4.6" ry="2.9" fill="var(--bird-deep)" transform="rotate(18 14.5 13)"/>'
      + '<circle cx="6.4" cy="17.2" r="4.4" fill="var(--bird)"/>'
      + '<path d="M2.6 18 L0 19.2 L2.7 20.2 Q3.3 19 2.6 18 Z" fill="#e8a24c"/>'
      + '<circle cx="5.3" cy="16" r="1" fill="var(--snout)"/>'
      + '<rect x="11" y="19" width="1.4" height="3.8" rx=".7" fill="var(--wood-2)"/>'
      + '<rect x="14.4" y="19" width="1.4" height="3.8" rx=".7" fill="var(--wood-2)"/>';
  }
  else if(phase === 'dawn'){
    b = '<ellipse cx="13" cy="22.6" rx="6.5" ry="1.4" fill="var(--gshadow)"/>'
      + '<rect x="16.5" y="14.5" width="6.4" height="3.2" rx="1.6" fill="var(--bird-deep)" transform="rotate(34 19.7 16)"/>'
      + '<rect x="0.6" y="7.6" width="8" height="3.6" rx="1.8" fill="var(--bird-deep)" transform="rotate(-24 4.6 9.4)"/>'
      + '<rect x="17.4" y="7.6" width="8" height="3.6" rx="1.8" fill="var(--bird-deep)" transform="rotate(24 21.4 9.4)"/>'
      + '<ellipse cx="13" cy="13.5" rx="6.6" ry="7.2" fill="var(--bird)"/>'
      + '<ellipse cx="12.7" cy="16.5" rx="4.2" ry="4.4" fill="var(--coat-cream)"/>'
      + '<circle cx="13" cy="6.8" r="4.4" fill="var(--bird)"/>'
      + '<path d="M8.9 6.2 L6.4 7 L9 8 Q9.5 7 8.9 6.2 Z" fill="#e8a24c"/>'
      + '<circle cx="11.2" cy="5.6" r="1" fill="var(--snout)"/>'
      + '<rect x="10.8" y="19.5" width="1.4" height="3.6" rx=".7" fill="var(--wood-2)"/>'
      + '<rect x="13.8" y="19.5" width="1.4" height="3.6" rx=".7" fill="var(--wood-2)"/>';
  }
  else if(phase === 'dusk'){
    b = '<g transform="translate(26 0) scale(-1 1)">'
      + '<ellipse cx="13" cy="22.8" rx="5.5" ry="1.3" fill="var(--gshadow)" opacity=".85"/>'
      + '<rect x="16.8" y="10.5" width="6.6" height="3.2" rx="1.6" fill="var(--bird-deep)" transform="rotate(-24 20 12)"/>'
      + '<ellipse cx="12.5" cy="13" rx="6.4" ry="7" fill="var(--bird)" transform="rotate(-8 12.5 13)"/>'
      + '<ellipse cx="11.6" cy="16.2" rx="4" ry="4" fill="var(--coat-cream)"/>'
      + '<ellipse cx="14.5" cy="12" rx="4" ry="2.7" fill="var(--bird-deep)" transform="rotate(-12 14.5 12)"/>'
      + '<circle cx="9.5" cy="6.6" r="4.2" fill="var(--bird)"/>'
      + '<path d="M5.6 6.2 L3.1 7 L5.7 8 Q6.2 7 5.6 6.2 Z" fill="#e8a24c"/>'
      + '<circle cx="8" cy="5.4" r="1" fill="var(--snout)"/>'
      + '<rect x="10.6" y="18.6" width="1.4" height="2.8" rx=".7" fill="var(--wood-2)"/>'
      + '<rect x="13.6" y="18.6" width="1.4" height="2.8" rx=".7" fill="var(--wood-2)"/>'
      + '</g>';
  }
  else{
    b = '<ellipse cx="13" cy="22.6" rx="7" ry="1.5" fill="var(--gshadow)"/>'
      + '<rect x="18" y="15.5" width="6" height="3.2" rx="1.6" fill="var(--bird-deep)" transform="rotate(16 21 17)"/>'
      + '<circle cx="13" cy="15" r="7.6" fill="var(--bird)"/>'
      + '<ellipse cx="12.6" cy="18.4" rx="4.8" ry="3.6" fill="var(--coat-cream)"/>'
      + '<ellipse cx="16.5" cy="14" rx="4" ry="2.8" fill="var(--bird-deep)" transform="rotate(24 16.5 14)"/>'
      + '<path d="M7.8 14.6 L5.9 17 L8.7 17.3 Q9 15.9 7.8 14.6 Z" fill="#e8a24c"/>'
      + '<path d="M8.9 12.4 q1.3 1.4 2.6 0" fill="none" stroke="var(--snout)" stroke-width="1.1" stroke-linecap="round"/>';
  }
  return '<svg viewBox="0 0 26 24" aria-hidden="true"><g class="pb">'+b+'</g>'
    + (phase==='night' ? zz(2,4,.62) : '') + '</svg>';
}
function svgDuck(phase){
  var u = ++_uid, b = '';
  var bill = function(x,y){
    return '<path d="M'+x+' '+y+' L'+(x-4.8)+' '+(y+1.3)+' L'+x+' '+(y+2.8)+' Q'+(x+.9)+' '+(y+1.4)+' '+x+' '+y+' Z" fill="#e8a24c"/>';
  };
  if(phase === 'day'){
    b = '<defs><radialGradient id="p_pd'+u+'" cx="42%" cy="34%" r="80%">'
      + '<stop offset="0%" stop-color="var(--water-1)"/><stop offset="100%" stop-color="var(--water-2)"/>'
      + '</radialGradient></defs>'
      + '<ellipse cx="23" cy="30.5" rx="22" ry="5.2" fill="var(--sand)"/>'
      + '<ellipse cx="23" cy="30" rx="19.5" ry="4.2" fill="url(#p_pd'+u+')"/>'
      + '<ellipse cx="15" cy="30.8" rx="7.5" ry="1.6" fill="none" stroke="rgba(255,255,255,.4)" stroke-width="1.1"/>'
      + '<ellipse cx="30" cy="28.8" rx="7" ry="1.7" fill="rgba(255,255,255,.3)"/>'
      + '<path d="M22 27 Q22 21.5 28.5 21.5 Q34 21.5 35.5 24.5 L40 21.5 Q41 26.5 36 28.5 Q32.5 30 27 29.5 Q22.5 29 22 27 Z" fill="var(--coat-cream)"/>'
      + '<ellipse cx="31" cy="25.5" rx="4" ry="2.6" fill="#e7dcc0"/>'
      + '<rect x="20.2" y="16" width="5" height="8.5" rx="2.5" fill="var(--coat-cream)"/>'
      + '<circle cx="22.5" cy="17" r="4.6" fill="var(--coat-cream)"/>'
      + bill(18.4,15.9)
      + '<circle cx="21" cy="15.8" r="1" fill="var(--snout)"/>';
  }
  else if(phase === 'dawn'){
    b = '<ellipse cx="22" cy="34" rx="11" ry="2" fill="var(--gshadow)"/>'
      + '<rect x="18.6" y="28.5" width="2.6" height="5" rx="1.3" fill="#e8a24c"/>'
      + '<rect x="23.8" y="28.5" width="2.6" height="5" rx="1.3" fill="#e8a24c"/>'
      + '<ellipse cx="19.6" cy="33.6" rx="2.9" ry="1.2" fill="#e8a24c"/>'
      + '<ellipse cx="24.8" cy="33.6" rx="2.9" ry="1.2" fill="#e8a24c"/>'
      + '<rect x="9.5" y="11" width="4.8" height="11.5" rx="2.4" fill="#e7dcc0" transform="rotate(30 11.9 16.7)"/>'
      + '<rect x="30.2" y="11" width="4.8" height="11.5" rx="2.4" fill="#e7dcc0" transform="rotate(-30 32.6 16.7)"/>'
      + '<ellipse cx="22.5" cy="23.5" rx="8.6" ry="7.6" fill="var(--coat-cream)"/>'
      + '<ellipse cx="24.5" cy="25.5" rx="4.2" ry="3" fill="#e7dcc0"/>'
      + '<rect x="20.2" y="9.5" width="5" height="8" rx="2.5" fill="var(--coat-cream)"/>'
      + '<circle cx="22.7" cy="9.2" r="4.6" fill="var(--coat-cream)"/>'
      + bill(18.6,8.1)
      + '<circle cx="21.2" cy="8" r="1" fill="var(--snout)"/>';
  }
  else if(phase === 'dusk'){
    b = '<g transform="translate(46 0) scale(-1 1)">'
      + '<ellipse cx="24" cy="34" rx="12" ry="2" fill="var(--gshadow)"/>'
      + '<rect x="20" y="28" width="2.6" height="5.5" rx="1.3" fill="#e8a24c" transform="rotate(-12 21.3 30.8)"/>'
      + '<rect x="26" y="28.5" width="2.6" height="5" rx="1.3" fill="#e8a24c" transform="rotate(12 27.3 31)"/>'
      + '<ellipse cx="19.6" cy="33.4" rx="2.9" ry="1.2" fill="#e8a24c"/>'
      + '<ellipse cx="27.8" cy="33.6" rx="2.9" ry="1.2" fill="#e8a24c"/>'
      + '<path d="M33 21.5 Q37.5 18.5 36.5 24 Q35.8 27 33 26.5 Z" fill="var(--coat-cream)"/>'
      + '<ellipse cx="25" cy="24.5" rx="10.5" ry="7" fill="var(--coat-cream)"/>'
      + '<ellipse cx="27.5" cy="25.5" rx="4.6" ry="3" fill="#e7dcc0"/>'
      + '<rect x="13.4" y="13" width="5" height="9" rx="2.5" fill="var(--coat-cream)"/>'
      + '<circle cx="15.9" cy="12.5" r="4.8" fill="var(--coat-cream)"/>'
      + bill(11.6,11.4)
      + '<circle cx="14.3" cy="11.3" r="1" fill="var(--snout)"/>'
      + '</g>';
  }
  else{
    b = '<ellipse cx="23" cy="34" rx="12" ry="2" fill="var(--gshadow)"/>'
      + '<ellipse cx="23" cy="26.5" rx="10" ry="7.4" fill="var(--coat-cream)"/>'
      + '<path d="M13.4 23 Q10 21 11 25.5 Q11.6 27.5 13.6 26.8 Z" fill="var(--coat-cream)"/>'
      + '<ellipse cx="26" cy="26.5" rx="5.6" ry="3.8" fill="#e7dcc0"/>'
      + '<ellipse cx="29" cy="24.8" rx="4.2" ry="2" fill="rgba(120,95,70,.08)"/>'
      + '<circle cx="30" cy="20.5" r="4.8" fill="var(--coat-cream)"/>'
      + '<path d="M27 22.4 L23.6 24.8 L27.4 25.6 Q28.2 24 27 22.4 Z" fill="#e8a24c"/>'
      + '<path d="M30.4 19.6 q1.3 1.4 2.6 0" fill="none" stroke="var(--snout)" stroke-width="1.1" stroke-linecap="round"/>';
  }
  return '<svg viewBox="0 0 46 36" aria-hidden="true"><g class="pb">'+b+'</g>'
    + (phase==='night' ? zz(26,7,.85) : '') + '</svg>';
}

/* catalog maps (verbatim) */
var TREEFN = {oak:svgOak, cherry:svgCherry, pine:svgPine, willow:svgWillow, kumquat:svgKumquat, mango:svgMango, coconut:svgCoconut};
var PETFN  = {dog:svgDog, cat:svgCat, rabbit:svgRabbit, bird:svgBird, duck:svgDuck};
var PETW   = {dog:46, cat:42, rabbit:38, bird:23, duck:46};

/* ============================================================================
   HOUSE SHELL — the app-integrated port of the mock's buildHouse(kind,phase).
   Roof/wall/extras are the mock's markup; the caller injects the app's real
   door + member windows (winsInner) into .hs-wins, and the chimney smokes when
   the family did something today (act), not on the dawn phase.
   ============================================================================ */
function buildHouseShell(kind, phase, winsInner, act){
  var puffs = act ? '<i class="puff"></i><i class="puff p2"></i><i class="puff p3"></i>' : '';
  var roof;
  if(kind==='modern')     roof = '<i class="hs-flue">'+puffs+'</i><i class="hs-roof"></i>';
  else if(kind==='tile')  roof = '<i class="hs-chim">'+puffs+'</i><i class="hs-roof"></i><i class="ridge"></i>';
  else                    roof = '<i class="hs-chim">'+puffs+'</i><i class="hs-roof"></i>';
  var extra = kind==='modern' ? '<i class="slat"></i>'
            : kind==='tile'   ? '<i class="eave"></i><i class="lant"></i>'
            : kind==='brick'  ? '<i class="attic"></i>' : '';
  return '<div class="sc-house hm-'+kind+'">'
    + '<div class="hs-roofwrap">'+roof+'</div>'
    + '<div class="hs-wall">'+extra
    +   '<div class="hs-wins">'+(winsInner||'')+'</div><i class="rim"></i>'
    + '</div></div>';
}

/* ============================================================================
   CONFIG STORE — {house,tree,pet} from window.FAM.house, defaulted + validated.
   ============================================================================ */
var HOUSE_KEYS = {
  house: ['cottage','modern','tile','brick'],
  tree:  ['oak','cherry','pine','willow','kumquat','mango','coconut'],
  pet:   ['dog','cat','rabbit','bird','duck']
};
function _houseValid(part, v){ return !!(v && HOUSE_KEYS[part] && HOUSE_KEYS[part].indexOf(v) >= 0); }
function houseCfg(){
  var h = (window.FAM && window.FAM.house && typeof window.FAM.house === 'object') ? window.FAM.house : {};
  return {
    house: _houseValid('house', h.house) ? h.house : 'cottage',
    tree:  _houseValid('tree',  h.tree)  ? h.tree  : 'oak',
    pet:   _houseValid('pet',   h.pet)   ? h.pet   : null
  };
}
/* optimistic set → persist through the write-through layer → repaint the scene */
function pickHouse(part, value){
  if(part === 'pet' && (value === null || value === 'none' || value === '')) value = null;
  else if(!_houseValid(part, value)) return;
  window.FAM = window.FAM || {};
  if(!window.FAM.house || typeof window.FAM.house !== 'object') window.FAM.house = {};
  window.FAM.house[part] = value;                                  // optimistic local echo
  if(typeof window.setFamilyHouse === 'function') window.setFamilyHouse(houseCfg());
  if(typeof window.renderHome === 'function') window.renderHome(); // repaint the live scene (mirrors setWeather)
  _houseToolboxRefresh();                                          // update checks + thumbnails under the sheet
}

/* ============================================================================
   TOOLBOX — the 3-picker bottom sheet ("Chăm chút tổ ấm"). Reuses the app's
   own .sheet / #scrim scaffolding (created once, opened via openSheet).
   ============================================================================ */
var _HOUSE_SEG = 'tree';   // the hero is pure nature now — no house segment in the picker
/* functional control icons are inline SVG (stroke=currentColor), not emoji —
   emoji stay content-only marks elsewhere (DESIGN.md §2.6) */
var _HOUSE_SVG = {
  house: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 11l8-7 8 7"/><path d="M6 10v9a1 1 0 001 1h10a1 1 0 001-1v-9"/><path d="M10 20v-5h4v5"/></svg>',
  tree:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="9" r="6"/><path d="M12 15v6"/></svg>',
  pet:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="16" rx="5" ry="4"/><circle cx="6" cy="9" r="2"/><circle cx="11" cy="6" r="2"/><circle cx="16" cy="6.5" r="2"/><circle cx="19.5" cy="10.5" r="2"/></svg>'
};
/* NOTE: the scene went nature-only (Hơi thở của gió) — the house segment left
   the picker, but families.house's `house` key stays in the config store so
   nothing migrates and an older build still reads its saved value. */
var _HOUSE_CAT = {
  tree:  { icon:_HOUSE_SVG.tree, vi:'Cây', en:'Tree', items:[
    {v:'oak',vi:'Sồi',en:'Oak'},{v:'cherry',vi:'Anh đào',en:'Cherry'},{v:'pine',vi:'Thông',en:'Pine'},
    {v:'willow',vi:'Liễu',en:'Willow'},{v:'kumquat',vi:'Quất',en:'Kumquat'},
    {v:'mango',vi:'Xoài',en:'Mango'},{v:'coconut',vi:'Dừa',en:'Coconut'} ] },
  pet:   { icon:_HOUSE_SVG.pet, vi:'Thú cưng', en:'Pet', items:[
    {v:null,vi:'Không',en:'None'},{v:'dog',vi:'Chó',en:'Dog'},{v:'cat',vi:'Mèo',en:'Cat'},
    {v:'rabbit',vi:'Thỏ',en:'Rabbit'},{v:'bird',vi:'Chim',en:'Bird'},{v:'duck',vi:'Vịt',en:'Duck'} ] }
};
/* a couple of sample windows for the thumbnails' house shell */
function _thumbWins(phase){
  var lit = (phase === 'dusk' || phase === 'night');
  function w(cls){ return '<span class="hw"><span class="hw-pane ' + cls + (lit ? ' lit' : '') + '"></span></span>'; }
  return '<span class="hs-door"></span>' + w('p-ok') + w('p-sun');
}
/* the real builder thumbnail for one option, at the current sky phase */
function _houseThumb(seg, v, phase){
  var inner = '<i class="th-ground"></i>';
  if(seg === 'house')      inner += '<div class="th-house">' + buildHouseShell(v, phase, _thumbWins(phase), false) + '</div>';
  else if(seg === 'tree')  inner += '<div class="th-tree">' + TREEFN[v](phase) + '</div>';
  else if(v){ var pw = Math.round((PETW[v] || 40) * 1.35);
             inner += '<div class="th-pet k-' + v + '" style="width:' + pw + 'px">' + PETFN[v](phase) + '</div>'; }
  else                     inner += '<div class="th-none">' + (typeof L==='function'?L('Không nuôi','No pet'):'None') + '</div>';
  return '<div class="thumb sky-' + phase + '">' + inner + '</div>';
}
function _houseSheetEl(){
  var el = document.getElementById('sheet-house');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'sheet-house';
  el.className = 'sheet sheet-house';
  var scrim = document.getElementById('scrim');
  if(scrim && scrim.parentNode) scrim.parentNode.appendChild(el);
  else document.body.appendChild(el);
  // built after boot's one-time `.sheet` sweep (80-onboard-boot.js), so it
  // never got drag-to-dismiss wired up the way every static sheet does
  if(typeof initSheetDrag === 'function') initSheetDrag(el, closeSheet);
  return el;
}
function _renderHouseToolbox(el){
  var _L = (typeof L === 'function') ? L : function(a){ return a; };
  var phase = (typeof _skyPhase === 'function') ? _skyPhase() : 'day';
  var cfg = houseCfg();
  var segs = Object.keys(_HOUSE_CAT).map(function(k){
    var c = _HOUSE_CAT[k];
    return '<button class="seg' + (k === _HOUSE_SEG ? ' on' : '') + '" onclick="_houseSeg(&#39;' + k + '&#39;)">'
      + '<span class="e">' + c.icon + '</span>' + _L(c.vi, c.en) + '</button>';
  }).join('');
  var g = _HOUSE_CAT[_HOUSE_SEG];
  var cur = cfg[_HOUSE_SEG];
  var opts = g.items.map(function(it){
    var on = (it.v === cur) || (_HOUSE_SEG === 'pet' && !it.v && !cur);
    var arg = (it.v === null) ? 'null' : ('&#39;' + it.v + '&#39;');
    return '<button class="opt' + (on ? ' on' : '') + '" onclick="pickHouse(&#39;' + _HOUSE_SEG + '&#39;,' + arg + ')">'
      + _houseThumb(_HOUSE_SEG, it.v, phase)
      + '<div class="nm">' + _L(it.vi, it.en) + '</div></button>';
  }).join('');
  el.innerHTML = '<div class="grab"></div>'
    + '<div class="sheet-h">' + _L('Chăm chút tổ ấm', 'Make it home') + '</div>'
    + '<div class="sheet-sub">' + _L('Chọn cây tiết kiệm và bạn nhỏ — hiện ngay trên khung trời trang chủ.',
                 'Pick a savings tree and a little friend — they appear in your home sky at once.') + '</div>'
    + '<div class="segs">' + segs + '</div>'
    + '<div class="sh-body"><div class="opts">' + opts + '</div></div>';
}
function _houseToolboxRefresh(){
  var el = document.getElementById('sheet-house');
  if(el && el.classList.contains('on')) _renderHouseToolbox(el);
}
function _houseSeg(k){
  _HOUSE_SEG = k;
  var el = document.getElementById('sheet-house');
  if(el) _renderHouseToolbox(el);
}
function openHouseToolbox(){
  var el = _houseSheetEl();
  _renderHouseToolbox(el);
  if(typeof openSheet === 'function') openSheet('sheet-house');
  else { document.getElementById('scrim').classList.add('on'); el.classList.add('on'); }
}

/* the persistent, prominent home-feed entry that opens the toolbox */
function _houseEntryHTML(){
  var _L = (typeof L === 'function') ? L : function(a){ return a; };
  return '<button class="house-entry" onclick="openHouseToolbox()">'
    + '<span class="he-ic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 00-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 005.4-5.4l-2.8 2.8-2-2z"/></svg></span>'
    + '<span class="he-tt"><b>' + _L('Chăm chút tổ ấm', 'Make it home') + '</b>'
    + '<span>' + _L('Đổi cây · thú cưng cho cả nhà', 'Change your tree · pet') + '</span></span>'
    + '<svg class="he-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 18l6-6-6-6"/></svg>'
    + '</button>';
}

/* ============================================================================
   TAP DELIGHT — pokePet()/pokeTree(), wired onto the .sc-pet/.sc-tree buttons
   renderScene() builds. Every tap answers: pets hop + speak (a sleepy Zzz after
   dark; hearts when you keep petting — the quiet rabbit leads with hearts),
   trees rustle + shed species-colored leaves (the kumquat drops a fruit), and
   every 5th shake whispers what the tree means. One-shot DOM particles; a
   re-render sweeping them early is harmless.
   ============================================================================ */
var _PET_SAY = {
  dog:  ['Gâu gâu!',  'Woof woof!'],
  cat:  ['Meo meo~',  'Meow~'],
  bird: ['Chíp chíp!','Tweet tweet!'],
  duck: ['Cạp cạp!',  'Quack quack!'],
  rabbit: null                                        // rabbits don't talk — they hop, and hearts do the talking
};
function _pokeCls(el, ms){
  el.classList.remove('poke'); void el.offsetWidth; el.classList.add('poke');
  clearTimeout(el._pokeT);
  el._pokeT = setTimeout(function(){ el.classList.remove('poke'); }, ms);
}
function _buzz(ms){ try{ if(navigator.vibrate) navigator.vibrate(ms); }catch(e){} }
function _sayBubble(el, txt){
  var old = el.querySelector('.say'); if(old && old.parentNode) old.parentNode.removeChild(old);
  var b = document.createElement('span');
  b.className = 'say'; b.textContent = txt;
  el.appendChild(b);
  setTimeout(function(){ if(b.parentNode) b.parentNode.removeChild(b); }, 1600);
}
var _HEART_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.3C6.4 16.5 2.5 12.9 2.5 8.9 2.5 6 4.7 4 7.3 4c1.9 0 3.6 1 4.7 2.7C13.1 5 14.8 4 16.7 4c2.6 0 4.8 2 4.8 4.9 0 4-3.9 7.6-9.5 11.4z" fill="{c}"/></svg>';
function _heartBurst(el, n){
  var cols = ['#e0604c', '#f0784f', '#e88aa0'];
  for(var i = 0; i < n; i++){
    var h = document.createElement('i');
    h.className = 'fx-heart';
    h.style.left = (14 + Math.random() * 62).toFixed(0) + '%';
    h.style.top = (-6 + Math.random() * 24).toFixed(0) + 'px';
    h.style.setProperty('--hr', (Math.random() * 30 - 15).toFixed(0) + 'deg');
    h.style.animationDelay = (i * 0.12).toFixed(2) + 's';
    h.innerHTML = _HEART_SVG.replace('{c}', cols[i % cols.length]);
    el.appendChild(h);
    (function(p){ setTimeout(function(){ if(p.parentNode) p.parentNode.removeChild(p); }, 1800); })(h);
  }
}
var _petTaps = 0, _petTapAt = 0;
function pokePet(){
  var el = document.querySelector('#home-scene .sc-pet'); if(!el) return;
  var kind = houseCfg().pet;
  var ph = (typeof _scenePhase === 'function') ? _scenePhase() : 'day';   // react to the painted scene, not the raw clock
  _pokeCls(el, 950);
  var now = Date.now();
  _petTaps = (now - _petTapAt < 2500) ? _petTaps + 1 : 1;
  _petTapAt = now;
  if(ph === 'night'){ _sayBubble(el, 'Zzz…'); }        // asleep — let them dream
  else {
    var s = _PET_SAY[kind];
    if(s && typeof L === 'function') _sayBubble(el, L(s[0], s[1]));
    if(kind === 'rabbit' || _petTaps % 3 === 0) _heartBurst(el, kind === 'rabbit' ? 2 : 3);
  }
  _buzz(8);
}
var _LEAF_COL = { oak:'var(--brand-2)', cherry:'var(--blossom-pale)', pine:'var(--leaf-2)', willow:'var(--brand-2)', kumquat:'var(--leaf-2)', mango:'var(--brand-2)', coconut:'var(--leaf-2)' };
var _treeTaps = 0;
function pokeTree(){
  var el = document.querySelector('#home-scene .sc-tree'); if(!el) return;
  var kind = houseCfg().tree;
  _pokeCls(el, 900);
  for(var i = 0; i < 4; i++){
    var p = document.createElement('i');
    p.className = 'fx-leaf' + (kind === 'cherry' ? ' pt' : kind === 'pine' ? ' needle' : '');
    p.style.left = (16 + Math.random() * 58).toFixed(0) + '%';
    p.style.top = (10 + Math.random() * 34).toFixed(0) + '%';
    p.style.background = _LEAF_COL[kind] || 'var(--brand-2)';
    p.style.setProperty('--lx', (Math.random() * 26 - 8).toFixed(0) + 'px');
    p.style.animationDelay = (i * 0.09).toFixed(2) + 's';
    el.appendChild(p);
    (function(q){ setTimeout(function(){ if(q.parentNode) q.parentNode.removeChild(q); }, 2000); })(p);
  }
  if(kind === 'kumquat' || kind === 'mango'){                 // fruit trees drop a fruit
    var f = document.createElement('i');
    f.className = 'fx-fruit' + (kind === 'mango' ? ' mg' : '');
    f.style.left = (26 + Math.random() * 34).toFixed(0) + '%';
    f.style.top = '26%';
    el.appendChild(f);
    setTimeout(function(){ if(f.parentNode) f.parentNode.removeChild(f); }, 1400);
  }
  _treeTaps++;
  if(_treeTaps % 5 === 0){                             // now and then, whisper what the tree means
    var host = document.getElementById('home-scene');
    if(host && typeof L === 'function'){
      var note = document.createElement('div');
      note.className = 'tree-note';
      note.textContent = L('Cây lớn lên cùng quỹ chung của nhà mình 🌱', 'The tree grows with your shared savings 🌱');
      host.appendChild(note);
      setTimeout(function(){ if(note.parentNode) note.parentNode.removeChild(note); }, 3400);
    }
  }
  _buzz(6);
}

window.pokePet = pokePet;
window.pokeTree = pokeTree;
window.buildHouseShell = buildHouseShell;
window._houseEntryHTML = _houseEntryHTML;
window.houseCfg = houseCfg;
window.pickHouse = pickHouse;
window.openHouseToolbox = openHouseToolbox;
window._houseSeg = _houseSeg;
window.TREEFN = TREEFN;
window.PETFN = PETFN;
window.PETW = PETW;
