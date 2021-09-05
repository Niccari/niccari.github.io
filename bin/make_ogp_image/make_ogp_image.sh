#!/bin/bash

root_path="../.."
content_path="$root_path/content/posts"

if [ ! -d $content_path ]; then
  echo "content($content_path) not found!"
  exit 1
fi

targets=$(find $content_path -name "*.md")
for target in ${targets[@]}
do
  output_dirname="${root_path}/docs/assets/img/ogp"
  output_path="${output_dirname}/$(sed 's|\.md|\.png|g'  <<< $(basename $target))"
  if [ -f $output_path ]; then
    echo "$target exists. skip."
    continue
  fi
  tcardgen \
    --fontDir fonts \
    --output $output_dirname \
    --config tcardgen.yaml \
    $target
done

