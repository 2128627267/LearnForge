$ErrorActionPreference = "Stop"
$BASE = "http://localhost:3000"

Write-Host "== demo: batch create 3 cards + 2 relations, then connect 1 more =="
$batchBody = @{
    items = @(
        @{ title = "Pythagorean theorem"; content = "a^2+b^2=c^2"; tags = @("math") },
        @{ title = "Right triangle";      content = "triangle with 90 degree angle"; tags = @("geometry") },
        @{ title = "Law of sines";        content = "a/sinA=b/sinB"; tags = @("trig") }
    )
    relations = @(
        @{ source = "0"; target = "1"; label = "prerequisite" },
        @{ source = "0"; target = "2"; label = "extend" }
    )
} | ConvertTo-Json -Depth 5

$r = Invoke-RestMethod -Uri "$BASE/api/cards/batch" -Method Post -ContentType "application/json" -Body $batchBody
Write-Host ("batch: created={0} cards, edges={1}, invalid={2}" -f $r.created.Count, $r.edges.Count, ($r.invalidRelations -join ","))

$connectBody = @{
    relations = @(
        @{ source = $r.created[1].id; target = $r.created[2].id; label = "related" }
    )
} | ConvertTo-Json -Depth 5

$c = Invoke-RestMethod -Uri "$BASE/api/cards/connect" -Method Post -ContentType "application/json" -Body $connectBody
Write-Host ("connect: created={0}, skipped={1}, invalid={2}" -f $c.created.Count, $c.skipped.Count, $c.invalid.Count)

$cv = Invoke-RestMethod -Uri "$BASE/api/canvas-layout" -Method Get
Write-Host ("canvas now: nodes={0}, edges={1}" -f $cv.data.nodes.Count, $cv.data.edges.Count)
