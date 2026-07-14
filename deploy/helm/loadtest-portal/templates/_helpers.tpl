{{- define "loadtest-portal.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "loadtest-portal.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{- define "loadtest-portal.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{- define "loadtest-portal.labels" -}}
helm.sh/chart: {{ include "loadtest-portal.chart" . }}
{{ include "loadtest-portal.selectorLabels" . }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- range $k, $v := .Values.commonLabels }}
{{ $k }}: {{ $v | quote }}
{{- end }}
{{- end }}

{{- define "loadtest-portal.selectorLabels" -}}
app.kubernetes.io/name: {{ include "loadtest-portal.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{- define "loadtest-portal.serviceAccountName" -}}
{{- printf "%s-sa" (include "loadtest-portal.fullname" .) }}
{{- end }}

{{- define "loadtest-portal.image" -}}
{{- $registry := .Values.global.imageRegistry -}}
{{- $repo := .repo -}}
{{- $tag := .tag | default "latest" -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry $repo $tag -}}
{{- else -}}
{{- printf "%s:%s" $repo $tag -}}
{{- end -}}
{{- end }}

{{- define "loadtest-portal.dbHost" -}}
{{- if .Values.externalDatabase.enabled -}}
{{- .Values.externalDatabase.host -}}
{{- else -}}
{{- printf "%s-postgres" (include "loadtest-portal.fullname" .) -}}
{{- end -}}
{{- end }}

{{- define "loadtest-portal.dbSecretName" -}}
{{- if .Values.externalDatabase.enabled -}}
{{- .Values.externalDatabase.existingSecret -}}
{{- else -}}
{{- printf "%s-db" (include "loadtest-portal.fullname" .) -}}
{{- end -}}
{{- end }}
