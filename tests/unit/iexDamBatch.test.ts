import {describe,expect,it,vi} from 'vitest';
import {createIexBatchQueue,iexBatchCounts,importIexBatch,validateIexBatch,type IexBatchPreview} from '@/features/market-prices/iexDamBatch';

const file=(name:string,index=0)=>new File([`file-${index}`],name,{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',lastModified:index});
const preview=(name:string,date:string):IexBatchPreview=>({source_filename:name,delivery_dates:[date],received_blocks:96,expected_blocks:96,
  checksum_sha256:`hash-${name}`,source_format:'XLSX',verification_status:'PENDING_CONFIRMATION',summary_rows_ignored:5,
  mcp:{mcp_min_rs_per_mwh:100,mcp_max_rs_per_mwh:10000,mcp_average_rs_per_mwh:4000}});

describe('IEX DAM client batch orchestration',()=>{
  it('keeps single-file selection working and preserves multi-file input order',()=>{
    expect(createIexBatchQueue([file('one.xlsx')])).toMatchObject([{filename:'one.xlsx',status:'PENDING'}]);
    expect(createIexBatchQueue([file('b.xlsx'),file('a.xlsx')]).map(item=>item.filename)).toEqual(['b.xlsx','a.xlsx']);
  });
  it('rejects unsupported extensions and more than 31 files before upload',()=>{
    expect(()=>createIexBatchQueue([file('bad.csv')])).toThrow('ONLY_XLSX_FILES_SUPPORTED');
    expect(()=>createIexBatchQueue(Array.from({length:32},(_,index)=>file(`${index}.xlsx`,index)))).toThrow('MAXIMUM_31_IEX_DAM_FILES');
  });
  it('validates sequentially, preserves internal dates, and continues after a bad file',async()=>{
    const queue=createIexBatchQueue([file('first.xlsx'),file('bad.xlsx'),file('third.xlsx')]);const order:string[]=[];let active=0,maxActive=0;
    const result=await validateIexBatch(queue,async selected=>{active++;maxActive=Math.max(maxActive,active);order.push(selected.name);await Promise.resolve();active--;if(selected.name==='bad.xlsx')throw new Error('INVALID_IEX_DAM_EXPORT');return preview(selected.name,selected.name==='first.xlsx'?'2026-05-01':'2025-07-02');},()=>false);
    expect(order).toEqual(['first.xlsx','bad.xlsx','third.xlsx']);expect(maxActive).toBe(1);
    expect(result.map(item=>item.status)).toEqual(['VALIDATED','FAILED_VALIDATION','VALIDATED']);
    expect(result[0].preview?.delivery_dates).toEqual(['2026-05-01']);expect(result[1].error).toBe('INVALID_IEX_DAM_EXPORT');
  });
  it('enforces 96/96 independently for every selected workbook',async()=>{const queue=createIexBatchQueue([file('incomplete.xlsx')]);
    const result=await validateIexBatch(queue,async()=>({...preview('incomplete.xlsx','2026-01-01'),received_blocks:95}),()=>false);
    expect(result[0]).toMatchObject({status:'FAILED_VALIDATION',error:'EXACT_96_BLOCK_IEX_DAM_REQUIRED'});});
  it('imports valid files sequentially, maps duplicates non-fatally, and never retries them',async()=>{let queue=await validateIexBatch(createIexBatchQueue([file('new.xlsx'),file('existing.xlsx'),file('next.xlsx')]),async selected=>preview(selected.name,'2026-05-01'),()=>false);
    const calls:string[]=[];queue=await importIexBatch(queue,async selected=>{calls.push(selected.name);if(selected.name==='existing.xlsx')throw new Error('DUPLICATE_MARKET_PRICE_IMPORT');},()=>false);
    expect(calls).toEqual(['new.xlsx','existing.xlsx','next.xlsx']);expect(queue.map(item=>item.status)).toEqual(['IMPORTED','ALREADY_IMPORTED','IMPORTED']);
    expect(queue.every(item=>item.file===null)).toBe(true);expect(iexBatchCounts(queue)).toEqual({selected:3,validated:3,imported:2,already_imported:1,failed:0});
  });
  it('retains failures and does not roll back prior successes',async()=>{let queue=await validateIexBatch(createIexBatchQueue([file('one.xlsx'),file('two.xlsx'),file('three.xlsx')]),async selected=>preview(selected.name,'2026-05-01'),()=>false);
    queue=await importIexBatch(queue,async selected=>{if(selected.name==='two.xlsx')throw new Error('MARKET_PRICE_COMMIT_FAILED: rejected');},()=>false);
    expect(queue.map(item=>item.status)).toEqual(['IMPORTED','FAILED_IMPORT','IMPORTED']);expect(queue[1].error).toContain('rejected');expect(iexBatchCounts(queue).failed).toBe(1);});
  it('cancels only after the current request and marks untouched files cancelled',async()=>{let cancel=false;const queue=createIexBatchQueue([file('one.xlsx'),file('two.xlsx')]);
    const previewCall=vi.fn(async selected=>{cancel=true;return preview(selected.name,'2026-05-01')});const result=await validateIexBatch(queue,previewCall,()=>cancel);
    expect(previewCall).toHaveBeenCalledTimes(1);expect(result.map(item=>item.status)).toEqual(['VALIDATED','CANCELLED']);});
});
