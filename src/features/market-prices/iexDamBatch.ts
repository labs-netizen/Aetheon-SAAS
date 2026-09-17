export const MAX_IEX_DAM_BATCH_FILES=31;
export type IexBatchStatus='PENDING'|'VALIDATING'|'VALIDATED'|'IMPORTING'|'IMPORTED'|'ALREADY_IMPORTED'|'FAILED_VALIDATION'|'FAILED_IMPORT'|'CANCELLED';
export interface IexBatchPreview {source_filename:string;delivery_dates:string[];received_blocks:number;expected_blocks:number;
  checksum_sha256:string;source_format:string;verification_status:string;summary_rows_ignored:number;
  mcp?:{mcp_min_rs_per_mwh:number;mcp_max_rs_per_mwh:number;mcp_average_rs_per_mwh:number};}
export interface IexBatchItem {id:string;filename:string;file:File|null;status:IexBatchStatus;preview:IexBatchPreview|null;error:string|null;}

export function createIexBatchQueue(files:File[]):IexBatchItem[]{
  if(files.length===0)return [];
  if(files.length>MAX_IEX_DAM_BATCH_FILES)throw new Error('MAXIMUM_31_IEX_DAM_FILES');
  if(files.some(file=>!file.name.toLowerCase().endsWith('.xlsx')))throw new Error('ONLY_XLSX_FILES_SUPPORTED');
  return files.map((file,index)=>({id:`${index}:${file.name}:${file.size}:${file.lastModified}`,filename:file.name,file,status:'PENDING',preview:null,error:null}));
}
const update=(items:IexBatchItem[],index:number,changes:Partial<IexBatchItem>)=>items.map((item,itemIndex)=>itemIndex===index?{...item,...changes}:item);
const cancelRemaining=(items:IexBatchItem[],from:number,statuses:IexBatchStatus[])=>items.map((item,index)=>index>=from&&statuses.includes(item.status)?{...item,status:'CANCELLED' as const}:item);

export async function validateIexBatch(items:IexBatchItem[],preview:(file:File)=>Promise<IexBatchPreview>,cancelled:()=>boolean,
  changed?:(items:IexBatchItem[])=>void){let next=items.map(item=>({...item}));
  for(let index=0;index<next.length;index++){
    if(cancelled()){next=cancelRemaining(next,index,['PENDING']);changed?.(next);break;}
    const item=next[index];if(item.status!=='PENDING'||!item.file)continue;
    next=update(next,index,{status:'VALIDATING',error:null});changed?.(next);
    try{const result=await preview(item.file);if(result.received_blocks!==96||result.expected_blocks!==96)throw new Error('EXACT_96_BLOCK_IEX_DAM_REQUIRED');
      next=update(next,index,{status:'VALIDATED',preview:result,error:null});}
    catch(error){next=update(next,index,{status:'FAILED_VALIDATION',file:null,error:error instanceof Error?error.message:String(error)});}
    changed?.(next);
  }return next;
}

export async function importIexBatch(items:IexBatchItem[],commit:(file:File,preview:IexBatchPreview)=>Promise<void>,cancelled:()=>boolean,
  changed?:(items:IexBatchItem[])=>void){let next=items.map(item=>({...item}));
  for(let index=0;index<next.length;index++){
    if(cancelled()){next=cancelRemaining(next,index,['VALIDATED']);changed?.(next);break;}
    const item=next[index];if(item.status!=='VALIDATED'||!item.file||!item.preview)continue;
    next=update(next,index,{status:'IMPORTING',error:null});changed?.(next);
    try{await commit(item.file,item.preview);next=update(next,index,{status:'IMPORTED',file:null,error:null});}
    catch(error){const message=error instanceof Error?error.message:String(error);next=update(next,index,{status:message.includes('DUPLICATE_MARKET_PRICE_IMPORT')?'ALREADY_IMPORTED':'FAILED_IMPORT',file:null,error:message});}
    changed?.(next);
  }return next;
}

export function iexBatchCounts(items:IexBatchItem[]){return {selected:items.length,validated:items.filter(item=>['VALIDATED','IMPORTING','IMPORTED','ALREADY_IMPORTED'].includes(item.status)).length,
  imported:items.filter(item=>item.status==='IMPORTED').length,already_imported:items.filter(item=>item.status==='ALREADY_IMPORTED').length,
  failed:items.filter(item=>item.status==='FAILED_VALIDATION'||item.status==='FAILED_IMPORT').length};}
