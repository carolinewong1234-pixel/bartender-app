// ═══ CORE UTILITIES ═══
// el(), sv(), v(), vf(), vi() etc. — used by every other module

function el(id){return document.getElementById(id);}
function el2(id){return document.getElementById(id);} // alias — use where 'el' shadowed by local var
function v(id){const e=el(id);return e?e.value:'';}
function vf(id){return parseFloat(v(id))||0;}
function vi(id){return parseInt(v(id))||0;}
function sv(id,val){const e=el(id);if(e)e.value=val;}   // safe set value
function sc(id,val){const e=el(id);if(e)e.checked=val;} // safe set checked
function gc2(id,val){const e=el(id);if(e)e.textContent=val;} // safe set text
function shtml(id,html){const e=el(id);if(e)e.innerHTML=html;} // safe set innerHTML

function dl(content,mime,filename){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([content],{type:mime}));a.download=filename;a.click();}
