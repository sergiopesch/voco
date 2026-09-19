#!/usr/bin/env python3
"""Revalidate retained TypeSafe responses and summarize without new inference."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import statistics

spec=importlib.util.spec_from_file_location('judge',Path(__file__).with_name('typesafe-evaluate.py'))
judge=importlib.util.module_from_spec(spec);spec.loader.exec_module(judge)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--evaluation',type=Path,required=True)
    parser.add_argument('--labels',type=Path)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    source=json.loads(args.evaluation.read_text())
    identity=judge.rubric_identity(source['results'])
    for row in source['results']:
        if row['requestSha256'] != judge.fingerprint(row['request']):
            raise ValueError('Retained request identity mismatch')
        if 'rubricSha256' in row and row['rubricSha256'] != judge.fingerprint(row['request']['questions']):
            raise ValueError('Retained case rubric identity mismatch')
    if source['schemaVersion'] >= 2 and any(source.get(key) != value for key,value in identity.items()):
        raise ValueError('Retained evaluation rubric identity mismatch')
    valid=[];invalid=[]
    for row in source['results']:
        try:
            value=row.get('rawResponse',row.get('response'))
            judge.validate_response(value,row['request']['questions'])
            valid.append({**row,'response':value})
        except (ValueError,TypeError,KeyError):invalid.append(row['id'])
    def summary(rows):
        meaning=[r['response']['answers']['meaning'] for r in rows]
        material=[r['response']['answers']['material_error']['noul'] for r in rows]
        return {'cases':len(rows),
                'meaningMean0to3':statistics.mean(a['score'] for a in meaning) if meaning else None,
                'meaningMean0to100':statistics.mean(a['score']/3*100 for a in meaning) if meaning else None,
                'meaningMinimumConfidence':min((a['confidence'] for a in meaning),default=None),
                'materialReviewFlagsAt0_5':sum(p>=.5 for p in material),
                'maximumMaterialErrorProbability':max(material,default=None)}
    groups={}
    for row in valid:
        group=('baseline' if row['id'].startswith('baseline-') else
               'context0' if row['id'].startswith('context0-') else 'all')
        groups.setdefault(group,[]).append(row)
    result={'schemaVersion':2,'model':source['model'],**identity,
            'legacyReportedRubricSha256':source['rubricSha256'] if source['schemaVersion']==1 else None,
            'scope':'judge_challenge_not_voco_quality' if args.labels else 'public_transcript_judgments',
            'requested':source['attempted'],'valid':len(valid),'invalidIds':invalid,
            'initialValidationErrors':source['errors'],'groups':{k:summary(v) for k,v in groups.items()},
            'inputTokens':sum(r['response']['usage']['input_tokens'] for r in valid),
            'outputTokens':sum(r['response']['usage']['output_tokens'] for r in valid),
            'calibration':None,'automaticAcceptance':False}
    if args.labels:
        if hashlib.sha256(args.labels.read_bytes()).hexdigest() != source['inputSha256']:
            raise ValueError('Labels do not match the evaluated input identity')
        labels={r['id']:r for r in json.loads(args.labels.read_text())['cases']}
        errors=[];squared=[];tp=fp=tn=fn=0
        for row in valid:
            label=labels[row['id']];a=row['response']['answers'];expected=label['expectedMaterialError']
            p=a['material_error']['noul'];prediction=p>=.5
            tp+=int(prediction and expected);fp+=int(prediction and not expected)
            tn+=int(not prediction and not expected);fn+=int(not prediction and expected)
            squared.append((p-int(expected))**2)
            errors.append(abs(a['meaning']['score']-label['expectedMeaning']))
        result['calibration']={'labelStatus':'Author challenge labels, not independently validated',
            'threshold':.5,'truePositive':tp,'falsePositive':fp,'trueNegative':tn,'falseNegative':fn,
            'brierScore':statistics.mean(squared) if squared else None,
            'meaningMeanAbsoluteError0to3':statistics.mean(errors) if errors else None,
            'heldOutJudgeValidation':False}
    with args.output.open('x') as handle:
        json.dump(result,handle,indent=2,allow_nan=False);handle.write('\n')
    print(json.dumps(result,indent=2))


if __name__=='__main__':main()
